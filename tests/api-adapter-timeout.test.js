// Поведенческий тест моста WebView2 <-> страница.
// В отличие от playback-guard.test.js (проверка наличия строк в исходнике)
// здесь код реально выполняется в песочнице vm с подставным window.chrome.webview,
// поэтому проверяется именно поведение: таймаут, ответ хоста, чистка колбэков.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'wwwroot', 'js', 'api-adapter.js'), 'utf8');

/** Сообщения, отправленные страницей в хост. */
const posted = [];
/** Обработчик ответа хоста (window.chrome.webview 'message'). */
let hostListener = null;
/** Перехваченные console.error — включая сообщения о таймауте. */
const errors = [];

const sandbox = {
    console: {
        log() {},
        warn() {},
        error(...args) { errors.push(args.map(String).join(' ')); }
    },
    setTimeout,
    clearTimeout,
    window: {
        chrome: {
            webview: {
                postMessage(message) { posted.push(JSON.parse(message)); },
                addEventListener(type, handler) {
                    if (type === 'message') hostListener = handler;
                }
            }
        }
    }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'api-adapter.js' });

/** Последнее сообщение, ушедшее в хост. */
function lastRequest() {
    assert.ok(posted.length > 0, 'сообщение в хост не отправлено');
    return posted[posted.length - 1];
}

/** Ответ хоста на последний запрос. */
function reply(resultRaw) {
    const request = lastRequest();
    assert.ok(hostListener, 'слушатель message не зарегистрирован');
    hostListener({ data: JSON.stringify({ callbackId: request.callbackId, resultRaw }) });
    return request;
}

(async () => {
    // 1. Ответ хоста резолвит промис и чистит очередь.
    const answered = vm.runInContext('sendToNative("getStore", { key: "settings" }, 5000)', sandbox);
    const request = reply({ success: true, value: 42 });
    assert.strictEqual(request.action, 'getStore', 'действие не дошло до хоста');
    assert.strictEqual(request.key, 'settings', 'данные действия потерялись');
    const resolved = await answered;
    assert.strictEqual(resolved.success, true, 'промис не разрешился ответом хоста');
    assert.strictEqual(resolved.value, 42, 'полезная нагрузка ответа потерялась');

    // 2. Нет ответа — срабатывает таймаут, резолвится null (не вечное ожидание).
    const started = Date.now();
    const timedOut = vm.runInContext('sendToNative("noAnswer", {}, 60)', sandbox);
    assert.strictEqual(await timedOut, null, 'таймаут должен резолвить null');
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 55, `таймаут сработал слишком рано: ${elapsed} мс`);
    assert.ok(elapsed < 2000, `таймаут сработал слишком поздно: ${elapsed} мс`);
    assert.ok(
        errors.some(line => line.includes('noAnswer') && line.includes('Таймаут')),
        'таймаут не попал в console.error');

    // 3. Поздний ответ на уже просроченный запрос не роняет обработчик.
    const stale = lastRequest();
    assert.doesNotThrow(() => {
        hostListener({ data: JSON.stringify({ callbackId: stale.callbackId, resultRaw: { ok: 1 } }) });
    }, 'поздний ответ вызвал исключение');

    // 4. WebView2API.set возвращает false, если хост не подтвердил запись.
    const failing = vm.runInContext('WebView2API.set("settings", { theme: "dark" })', sandbox);
    reply({ success: false });
    assert.strictEqual(await failing, false, 'set() вернул true без подтверждения хоста');

    // 5. ...и true при подтверждении.
    const succeeding = vm.runInContext('WebView2API.set("settings", { theme: "dark" })', sandbox);
    reply({ success: true });
    assert.strictEqual(await succeeding, true, 'set() вернул false при успешной записи');

    // 6. get() при отсутствии данных отдаёт значение по умолчанию, а не null.
    const withDefault = vm.runInContext('WebView2API.get("missing", [1, 2, 3])', sandbox);
    reply('null');
    const value = await withDefault;
    assert.strictEqual(JSON.stringify(value), '[1,2,3]', 'get() не вернул значение по умолчанию');

    // 7. Хранилище читается как JSON, а не как строка.
    const parsed = vm.runInContext('WebView2API.get("stations", [])', sandbox);
    reply('{"a":1}');
    const stations = await parsed;
    assert.strictEqual(stations.a, 1, 'get() не распарсил JSON из хранилища');

    console.log('API adapter bridge: OK');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
