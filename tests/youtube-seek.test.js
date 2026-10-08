// Перемотка YouTube (полоса под названием трека) и фикс «плавающей» громкости.
// Цепочка не должна рассыпаться по одному месту:
// 1) хост шлёт позицию/длительность событием nativeTime и принимает seekNative,
// 2) мост пропускает оба направления (seek вниз, nativeTime вверх),
// 3) страница рисует полосу только для очереди YouTube и умеет драг плюс кнопки,
// 4) слайдер громкости больше не пишет полный JSON стора на каждый input —
//    именно это и было причиной «плавающей» громкости: saveData() на десятки
//    событий в секунду забивал UI-поток, а setNativeVolume доезжал с опозданием.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

// ——— Хост (C#) ———
const main = read('MainForm.cs');
for (const marker of ['case "seekNative"', 'TimeChanged', '"nativeTime"', 'OnNativeTimeTick', 'SeekNative']) {
  if (!main.includes(marker)) throw new Error(`В MainForm.cs нет "${marker}"`);
}
// Дроссель обязателен: без него TimeChanged заставляет страницу обрабатывать
// десятки событий в секунду (250 мс — интервал отправки).
if (!main.includes('< 250')) {
  throw new Error('В MainForm.cs нет дросселя отправки позиции (250 мс)');
}

// ——— Мост (api-adapter) ———
const adapter = read('wwwroot', 'js', 'api-adapter.js');
for (const marker of [
  "seekNative: (ms) => sendToNative('seekNative', { ms })",
  'seekNative: (ms) => WebView2API.seekNative(ms)',
  "onNativeTime: (handler) => WebView2API.onHostEvent('nativeTime', handler)"
]) {
  if (!adapter.includes(marker)) throw new Error(`В api-adapter.js нет "${marker}"`);
}

// ——— Страница (renderer) ———
const renderer = read('wwwroot', 'js', 'renderer.js');
for (const marker of ['handleNativeTime', 'updateSeekUI', 'setupSeekControls', 'resetSeekState', 'formatSeekTime', 'switchTrack']) {
  if (!renderer.includes(marker)) throw new Error(`В renderer.js нет "${marker}"`);
}
// Подписка на событие позиции: без неё полоса никогда не обновится.
if (!renderer.includes("register('onNativeTime', handleNativeTime)")) {
  throw new Error('renderer.js не подписан на onNativeTime');
}
// ⏮/⏭ обязаны водить очередью через playYoutubeTrack (и глушить двойной клик).
if (!renderer.includes('playYoutubeTrack(queue.index + delta)')) {
  throw new Error('Кнопки ⏮/⏭ не переключают треки очереди через playYoutubeTrack');
}
if (!renderer.includes('if (!queue || state.isSwitching) return;')) {
  throw new Error('Переключение треков без guard\'а isSwitching — двойной клик запустит два трека');
}
// ——— Управление видно только у YouTube ———
// Гейт по очереди YouTube: state.ytQueue существует только у YouTube-станций,
// у обычного радио его нет — панель скрыта даже если нативный плеер
// сообщит какую-то длительность стрима.
if (!renderer.includes('const visible = Boolean(state.ytQueue) && state.nativeLength > 0;')) {
  throw new Error('updateSeekUI потерял гейт по очереди YouTube — панель будет видна на обычном радио');
}
// Полоса живёт ровно до остановки — вместе с очередью YouTube.
const stopPlayBody = renderer.match(/function stopPlay\(\) \{[\s\S]*?\n\}/);
if (!stopPlayBody || !stopPlayBody[0].includes('resetSeekState')) {
  throw new Error('stopPlay() не сбрасывает полосу перемотки');
}
// Новый трек начинается с чистого листа (сброс — в первых строках функции,
// окно 1500 символов, чтобы не захватить чужие вызовы дальше по файлу).
const trackIdx = renderer.indexOf('async function playYoutubeTrack(requestedIndex)');
if (trackIdx < 0) throw new Error('В renderer.js нет playYoutubeTrack()');
if (!renderer.slice(trackIdx, trackIdx + 1500).includes('resetSeekState();')) {
  throw new Error('playYoutubeTrack() не сбрасывает позицию перед новым треком');
}

// ——— UI: полоса в index.html и её стили ———
const html = read('wwwroot', 'index.html');
for (const id of ['seekControls', 'seekTrack', 'seekFill', 'seekTimeCurrent', 'seekTimeTotal', 'seekBackBtn', 'seekFwdBtn', 'seekPrevTrackBtn', 'seekNextTrackBtn']) {
  if (!html.includes(`id="${id}"`)) throw new Error(`В index.html нет #${id}`);
}
const css = read('wwwroot', 'styles.css');
for (const marker of ['.seek-controls', '.seek-track', '.seek-fill', 'container-type: inline-size', '@container (max-width: 250px)']) {
  if (!css.includes(marker)) throw new Error(`В styles.css нет "${marker}"`);
}
// Колонка now-playing-details — overflow:hidden: без ужатых размеров и
// container-запроса последняя кнопка (⏭) обрезалась на узких окнах.
if (!css.includes('gap: 6px')) {
  throw new Error('.seek-controls снова расточительный (gap) — ⏭ начнёт обрезаться');
}

// ——— Переводы: title кнопок обязаны найтись в словарях дословно ———
// Ключ словаря — исходный русский текст: одна переставленная буква (так
// однажды затесалась еврейская ד) и EN/LT/HE остаются с русским title.
const tm = read('wwwroot', 'modules', 'TranslationManager.js');
const titles = [...html.matchAll(/seek-btn[^>]*title="([^"]+)"/g)].map((m) => m[1]);
if (titles.length < 4) throw new Error('В index.html не найдены title кнопок панели управления (ожидалось не меньше 4)');
for (const title of titles) {
  if (!tm.includes(`'${title}'`)) {
    throw new Error(`В TranslationManager.js нет ключа для title "${title}"`);
  }
}

// ——— Фикс «плавающей» громкости ———
// Комментарии вычищаются: сам код не должен звать saveData() на input,
// а в поясняющих комментариях это слово встречается.
const stripComments = (code) => code.replace(/\/\/[^\n]*/g, '');
const mainInput = renderer.match(/volumeSlider\.addEventListener\('input',[\s\S]*?\n  \}\);/);
if (!mainInput) throw new Error('Не найден обработчик input основного слайдера');
if (stripComments(mainInput[0]).includes('saveData()')) {
  throw new Error('Слайдер громкости снова зовёт saveData() на каждый input — громкость вернётся к «плаванию»');
}
if (!mainInput[0].includes('scheduleVolumeSave()')) {
  throw new Error('Слайдер громкости не использует отложенное сохранение');
}
const miniInput = renderer.match(/miniVolumeSlider\.addEventListener\('input',[\s\S]*?\n    \}\);/);
if (!miniInput) throw new Error('Не найден обработчик input мини-слайдера');
if (stripComments(miniInput[0]).includes('saveData()')) {
  throw new Error('Мини-слайдер громкости зовёт saveData() на каждый input');
}
// Отложенное сохранение обязано быть и с немедленным флашем по отпусканию.
if (!/function scheduleVolumeSave\(\) \{[\s\S]*?setTimeout/.test(renderer)) {
  throw new Error('scheduleVolumeSave() без дебаунса (setTimeout)');
}
if (!renderer.includes("volumeSlider.addEventListener('change', flushVolumeSave)")) {
  throw new Error('Нет немедленного сохранения громкости по событию change');
}

console.log('youtube-seek: OK — nativeTime/seekNative, полоса в UI, громкость сохраняется через дебаунс');
