// UI настроек и адаптивной вёрстки. Проверяем якоря, вокруг которых построены
// требования пользователя (3.5.6):
//  1) Настройки без дубля меню: в строке вкладок остаются только
//     шестерёнка/крестик, крестик возвращает к плееру.
//  2) Вёрстка форм: одно поле — во всю длину, пара полей — ряд .form-row,
//     вертикальные отступы <= 5px, текст кнопок не вылезает за кнопку.
//  3) Язык+тема и страна+жанр — в одну строку; разделители секций.
//  4) Динамические размеры: списки и результаты поиска растягиваются с окном,
//     минимальная ширина окна подстраивается под контент.
//  5) Современные темы (Spotify, Apple Music, AMOLED) и общий режим data-mode.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const index = read('wwwroot', 'index.html');
const css = read('wwwroot', 'styles.css');
const renderer = read('wwwroot', 'js', 'renderer.js');
const themeManager = read('wwwroot', 'modules', 'ThemeManager.js');
const translations = read('wwwroot', 'modules', 'TranslationManager.js');

// ===== 1. Режим «только настройки + крестик» =====
assert.match(index, /class="gear-icon"/,
  'У шестерёнки нет иконки gear-icon — нечего переключать в режиме настроек');
assert.match(index, /class="close-icon"/,
  'Нет иконки close-icon — в режиме настроек нечем закрыть их и вернуться к плееру');
assert.match(css, /body\.settings-open \.tab-btn:not\(\[data-tab="settings"\]\)\s*\{\s*display: none;/,
  'body.settings-open не скрывает остальные вкладки — при открытии настроек остаётся дубль меню');
assert.match(css, /body\.settings-open \.tab-btn-icon \.gear-icon\s*\{\s*display: none;/,
  'В режиме настроек шестерёнка не превращается в крестик');
assert.match(renderer, /classList\.toggle\('settings-open', settingsOpen\)/,
  'switchTab не выставляет режим settings-open');
assert.match(renderer, /switchTab\(settingsReturnTab \|\| 'stations'\)/,
  'Клик по шестерёнке/крестику не возвращает на предыдущую вкладку');
assert.match(renderer, /let settingsReturnTab/,
  'Не запоминается вкладка, на которую возвращаться из настроек');

// ===== 2. Вёрстка форм =====
assert.match(css, /\.form-group \{\s*margin-bottom: 5px;/,
  'Отступ между элементами формы больше 5px');
assert.match(css, /\.form-group label \{\s*display: block;\s*margin-bottom: 5px;/,
  'Отступ между подписью и полем больше 5px');
assert.match(css, /\/\* Одно поле на строке[^*]*\*\/[\s\S]{0,400}width: 100%;/,
  'Одиночное поле ввода/селект/textarea не растягивается во всю длину');
assert.match(css, /\.form-row \{\s*display: grid;\s*grid-template-columns: 1fr 1fr;/,
  'Пара полей не разложена пропорционально и симметрично (1fr 1fr)');
assert.match(css, /\.btn \{[\s\S]{0,500}overflow: hidden;/,
  'Кнопки не обрезают текст — надписи могут выйти за пределы кнопки');

// ===== 3. Ряды и разделители =====
assert.match(index, /<div class="form-row">[\s\S]*?languageSelect[\s\S]*?themeSelect[\s\S]*?<\/div>/,
  'Язык интерфейса и тема не в одну строку');
assert.match(index, /<div class="form-row">[\s\S]*?stationCountry[\s\S]*?stationGenre[\s\S]*?<\/div>/,
  'Страна и жанр не в одну строку');
assert.match(css, /\.settings-section \{\s*margin-top: 8px;\s*padding-top: 16px;\s*border-top: 1px solid var\(--md-outline\);/,
  'Нет разделительной линии между секциями настроек (YouTube, станции, импорт)');

// ===== 4. Динамические размеры =====
assert.match(css, /\.online-results \{[\s\S]{0,400}flex: 1;/,
  'Результаты онлайн-поиска не растягиваются вместе с окном');
assert.ok(!/max-height: 320px/.test(css),
  'У результатов поиска снова потолок 320px — «обрубок» при растяжении окна');
assert.match(css, /#schedulesList \{\s*flex: 1;/,
  'Список планировщика не растягивается вместе с окном');
assert.match(css, /\.settings-panel\.active \{\s*display: flex;[\s\S]{0,200}overflow-y: auto;/,
  'Панель настроек не прокручивается внутри высоты окна');
assert.match(renderer, /function syncWindowMinWidth\(\)/,
  'Нет функции адаптации минимальной ширины окна');
assert.match(renderer, /AppAPI\.setWindowMinimumSize\(needed, 500\)/,
  'Минимальная ширина окна не подстраивается под контент');
assert.match(renderer, /scheduleWindowMinWidthSync\(\);[\s\S]{0,80}checkForUpdates\(\)/,
  'Пересчёт ширины окна не запускается при инициализации');

// ===== 5. Современные темы =====
for (const theme of ['spotify', 'apple', 'amoled']) {
  assert.ok(css.includes(`[data-theme="${theme}"]`),
    `Не найдены переменные темы «${theme}»`);
}
assert.match(index, /<option value="spotify">/,
  'Тема Spotify не выбрана в списке тем');
assert.match(index, /<option value="apple">/,
  'Тема Apple Music не выбрана в списке тем');
assert.match(index, /<option value="amoled">/,
  'Тема AMOLED не выбрана в списке тем');
assert.match(themeManager, /setAttribute\(\s*'data-mode',/,
  'ThemeManager не выставляет общий режим data-mode');
assert.ok(!/\[data-theme="dark"\] \./.test(css),
  'Компонентные правила остались на [data-theme="dark"] — новые тёмные темы их не унаследуют');
assert.match(css, /\[data-mode="dark"\] \./,
  'Нет компонентных правил по режиму [data-mode="dark"]');
const closeTranslations = (translations.match(/'Закрыть настройки':/g) || []).length;
assert.ok(closeTranslations >= 3,
  `Перевод «Закрыть настройки» есть не во всех языках (${closeTranslations}/3)`);

console.log('Settings UI: OK (режим настроек, ряды форм, динамические размеры, 3 темы, data-mode)');
