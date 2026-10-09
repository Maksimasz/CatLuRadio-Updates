// Бейдж обновления на шестерёнке (просьба 2026-10-09 «при запуске проверялось
// обновление и возле шестерёнки появлялась 1»). Проверка GitHub при запуске уже
// есть — checkForUpdates() в init (якорь в settings-ui.test.js), здесь
// проверяем, что её результат виден БЕЗ открытия настроек:
//  1) бейдж лежит внутри кнопки шестерёнки и скрыт по умолчанию;
//  2) стили: absolute-позиция и правило [hidden] (авторский класс иначе
//     перебивает UA-правило [hidden], и бейдж светился бы всегда);
//  3) логика: показ при hasUpdate, скрытие когда обновлений нет, подсказка
//     с версией; ошибка сети бейдж не трогает.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const index = read('wwwroot', 'index.html');
const css = read('wwwroot', 'styles.css');
const renderer = read('wwwroot', 'js', 'renderer.js');

// ===== 1. Разметка =====
const settingsBtn = index.match(/<button[^>]*data-tab="settings"[^>]*>[\s\S]*?<\/button>/);
assert.ok(settingsBtn, 'Кнопка шестерёнки (data-tab="settings") не найдена');
assert.match(settingsBtn[0], /id="updateBadge"[^>]*hidden[^>]*>1<\//,
  'Бейджа updateBadge нет внутри кнопки шестерёнки, он не скрыт по умолчанию или в нём не «1»');
assert.ok(settingsBtn[0].indexOf('id="updateBadge"') > settingsBtn[0].indexOf('close-icon'),
  'Бейдж должен лежать внутри кнопки — иначе клик по нему не откроет настройки');

// ===== 2. Стили =====
assert.match(css, /\.update-badge \{[^}]*position: absolute;/,
  'У бейджа нет position: absolute — он не привяжется к углу шестерёнки');
assert.match(css, /\.update-badge\[hidden\] \{\s*display: none;/,
  'Нет авторского .update-badge[hidden] { display: none } — бейдж не скроется через hidden');
assert.match(css, /\.tab-btn-icon \{[\s\S]{0,200}overflow: visible;/,
  'У .tab-btn-icon снова overflow: hidden — бейдж обрежется по краю кнопки');

// ===== 3. Логика показа/скрытия =====
const start = renderer.indexOf('async function checkForUpdates()');
const end = renderer.indexOf('async function installAvailableUpdate()');
assert.ok(start >= 0 && end > start, 'Функции checkForUpdates/installAvailableUpdate не найдены');
const check = renderer.slice(start, end);
assert.match(check, /badge\.hidden = false/,
  'checkForUpdates не показывает бейдж при найденном обновлении');
assert.match(check, /badge\.hidden = true/,
  'checkForUpdates не скрывает бейдж, когда обновлений нет');
assert.match(check, /badge\.title = t\('Доступна версия \{version\}\.'/,
  'На бейдже нет подсказки с доступной версией');
assert.ok(!/if \(!result\?\.success\)[\s\S]{0,200}badge\.hidden = true/.test(check),
  'Ошибка сети не должна гасить уже найденный бейдж — офлайн не отменяет обновление');

console.log('Update badge: OK (бейдж в кнопке шестерёнки, скрыт по умолчанию, показ/скрытие по результату проверки)');
