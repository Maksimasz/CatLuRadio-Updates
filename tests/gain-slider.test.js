// Ползунок усиления 0…+12 дБ (по умолчанию +6) — цепочка от вёрстки до Preamp.
// Жалоба 2026-10-09: радио тихое (Preamp +6 убрали в 3.5.6), а «бочка» была
// от того же вшитого +6. Решение — не возвращать константу, а дать ползунок:
// 1) в эквалайзере ползунок и статичный label (динамический span — только
//    число, иначе сломаются переводы),
// 2) значение живёт в state.settings.gainDb и переживает перезапуск,
// 3) мост setNativeGain отдельен от setNativeEqualizer (его сигнатура
//    закреплена playback-guard/youtube-queue, а полосы и Preamp независимы),
// 4) хост собирает цепочку заново: полосы + Preamp, при нуле усиления и
//    без полос — чистый проход (как в 3.5.6),
// 5) усиление действует и при выключенном эквалайзере (плоские полосы),
// 6) перегрузка исключена: диапазон ограничен 0…+12, а не ±20 из LibVLC.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const index = read('wwwroot', 'index.html');
const renderer = read('wwwroot', 'js', 'renderer.js');
const adapter = read('wwwroot', 'js', 'api-adapter.js');
const main = read('MainForm.cs');
const translations = read('wwwroot', 'modules', 'TranslationManager.js');

// ——— 1. Вёрстка ———
const slider = index.match(/<input[^>]*id="gainSlider"[^>]*>/);
assert.ok(slider, 'В index.html нет ползунка gainSlider');
assert.match(slider[0], /type="range"/, 'gainSlider должен быть range-ползунком');
assert.match(slider[0], /min="0"/, 'Минимум усиления — 0 дБ');
assert.match(slider[0], /max="12"/, 'Максимум усиления — +12 дБ: дальше LibVLC-Preamp и так клампит, а перегруз растёт');
assert.match(slider[0], /step="1"/, 'Шаг — целые дБ');
assert.ok(/id="gainValue"/.test(index), 'Нет числового индикатора gainValue');
assert.ok(index.includes('Усиление, дБ'), 'Label должен быть статичным (динамический span соединил бы число с переводом)');

// ——— 2. Состояние и сохранение ———
assert.match(renderer, /gainDb:\s*6/, 'Усиление по умолчанию +6 дБ (договорено 2026-10-09)');
assert.ok(renderer.includes('gainDb: Number.isFinite(Number(savedSettings.gainDb))'), 'Усиление не переживает перезапуск: нет слияния из savedSettings');
assert.ok(renderer.includes('function nativeGainDb()'), 'Нет хелпера nativeGainDb()');
assert.match(renderer, /Math\.min\(12, Math\.max\(0, db\)\)/, 'Значение не ограничено диапазоном 0…12');
assert.ok(renderer.includes('function applyNativeGain()'), 'Нет applyNativeGain()');
assert.ok(renderer.includes('scheduleGainSave()'), 'Ползунок шлёт десятки input в секунду — нужен дебаунс, а не saveData() на каждый');
assert.ok(renderer.includes("gainSlider.oninput"), 'Нет обработчика движения ползунка');

// ——— 3. Мост ———
assert.ok(adapter.includes("setNativeGain: (db) => sendToNative('setNativeGain', { db })"), 'В WebView2API нет setNativeGain');
assert.ok(adapter.includes('setNativeGain: (db) => WebView2API.setNativeGain(db)'), 'В AppAPI нет фасада setNativeGain');
// Сигнатура setNativeEqualizer не должна была измениться ради усиления
assert.ok(adapter.includes('setNativeEqualizer: (values) => WebView2API.setNativeEqualizer(values)'), 'Сигнатура setNativeEqualizer нарушена');

// ——— 4. Хост ———
assert.ok(main.includes('case "setNativeGain"'), 'В switch хоста нет setNativeGain');
assert.ok(main.includes('private void SetNativeGain(double db, string callbackId)'), 'Нет обработчика SetNativeGain');
assert.ok(main.includes('Math.Clamp(db, 0, 12)'), 'Усиление не ограничено 0…+12 дБ');
assert.ok(main.includes('private double nativeGainDb = 6'), 'Хост не хранит усиление (по умолчанию +6)');
assert.ok(main.includes('private bool ApplyEqualizerFilter()'), 'Полосы и Preamp не собираются общим методом');
assert.ok(main.includes('nativeEqualizer.SetPreamp((float)nativeGainDb)'), 'Preamp не применяется к LibVLC');
assert.match(
  main,
  /if \(!haveBands && nativeGainDb <= 0\)[\s\S]{0,400}nativePlayer\.UnsetEqualizer\(\)/,
  'При нуле усиления и без полос фильтр обязан сниматься (чистый проход 3.5.6)'
);
// Усиление действует и с выключенным эквалайзером — иначе ползунок молчит
// ровно в том состоянии, ради которого его и просили (тихое радио без EQ).
assert.ok(main.includes('bool haveBands = nativeEqValues is not null'), 'Усиление привязано к полосам вместо того, чтобы работать независимо');

// ——— 5. Переводы (EN/LT/HE) ———
const langs = ['en:', 'lt:', 'he:'];
for (const key of ['Усиление, дБ', 'YouTube временно отключён']) {
  const count = translations.split(key + "'").length - 1;
  // Ключ встречается один раз в каждом из трёх словарей (en/lt/he)
  assert.ok(count >= 3, `Ключ «${key}» переведён лишь ${count} раз(а) — нужны en/lt/he`);
}
for (const lang of langs) assert.ok(translations.includes(lang), `В словарях нет секции ${lang}`);

console.log('gain-slider: OK');
