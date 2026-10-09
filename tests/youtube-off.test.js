// YouTube отключён в публичном релизе 3.5.7: репозиторий открыт, а там yt-dlp
// падает с WinError 448. Требование — выпустить версию без YouTube, но код
// сохранить, чтобы включить обратно одной строкой. Отсюда флаг-гейт:
// 1) YOUTUBE_ENABLED = false — единственный переключатель,
// 2) секция добавления плейлиста скрыта, но разметка на месте (youtube-queue
//    тест требует id в index.html),
// 3) yt-станции не показываются ни в списке, ни в избранном, ни в истории,
//    но данные в сторе не трогаются,
// 4) запуск заблокирован с тостом, автозапуск пропускает молча,
// 5) строка-якорь groups.push(['YouTube', ytStations]) сохранена в коде.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const renderer = read('wwwroot', 'js', 'renderer.js');
const index = read('wwwroot', 'index.html');
const translations = read('wwwroot', 'modules', 'TranslationManager.js');

// 1. Флаг
assert.match(renderer, /const YOUTUBE_ENABLED = false;/, 'Нет выключенного флага YOUTUBE_ENABLED');
assert.ok(renderer.includes('const isYoutubeStation = station =>'), 'Нет хелпера isYoutubeStation');

// 2. Секция в настройках
assert.ok(index.includes('id="ytPlaylistSection"'), 'Секция YouTube потеряла id — включить обратно будет нечем');
assert.ok(renderer.includes('ytSection.style.display = YOUTUBE_ENABLED'), 'Секция YouTube не скрывается по флагу');
// Разметка и id кнопок должны остаться (иначе включение обратно = правки вёрстки)
assert.ok(index.includes('addYtPlaylistBtn') && index.includes('ytPlaylistUrl'), 'Разметка добавления плейлиста удалена вместо скрытия');

// 3. Списки
assert.ok(renderer.includes("YOUTUBE_ENABLED ? filtered : filtered.filter(s => !isYoutubeStation(s))"), 'yt-станции не отфильтрованы из списка станций');
assert.ok(renderer.includes("groups.push(['YouTube', ytStations]"), 'Якорь группы YouTube потерян — обратное включение станет правкой логики');
assert.ok(renderer.includes('if (!YOUTUBE_ENABLED) {\n    favoriteStations = favoriteStations.filter(s => !isYoutubeStation(s));'), 'yt-станции не отфильтрованы из избранного');
assert.ok(renderer.includes('state.history.filter(item => !isYoutubeStation('), 'yt-станции не отфильтрованы из истории');
// Фильтрация только рендерит: стор не трогаем
assert.ok(renderer.includes("state.settings.lastStationId = station.id"), 'Автозапуск пишет lastStationId — данные не должны теряться');

// 4. Guards
const playBody = renderer.slice(
  renderer.indexOf('async function playStation('),
  renderer.indexOf('async function playYoutubeStation(')
);
const guardAt = playBody.indexOf('if (!YOUTUBE_ENABLED)');
const launchAt = playBody.indexOf('return playYoutubeStation(station);');
assert.ok(guardAt !== -1, 'В playStation нет guard по флагу');
assert.ok(launchAt !== -1, 'В playStation пропал путь запуска YouTube');
assert.ok(guardAt < launchAt, 'Guard стоит после запуска — yt-станция стартует до проверки флага');
assert.ok(/if \(!YOUTUBE_ENABLED\) \{[\s\S]{0,160}showToast\(t\('YouTube временно отключён'\)/.test(playBody), 'Guard в playStation не показывает пояснение');
assert.ok(renderer.includes('Автозапуск пропущен: YouTube временно отключён'), 'Автозапуск не пропускает yt-станцию молча');
assert.ok(renderer.includes('if (!YOUTUBE_ENABLED) {\n    if (messageEl) {\n      messageEl.textContent = t(\'YouTube временно отключён\')'), 'Добавление плейлиста не заблокировано');
assert.ok(renderer.includes('const toCheck = YOUTUBE_ENABLED ? state.stations : state.stations.filter(s => !isYoutubeStation(s))'), 'Проверка станций не исключает yt-плейлисты');

// 5. Переводы тоста
const count = translations.split("'YouTube временно отключён'").length - 1;
assert.ok(count >= 3, `Тост переведён лишь ${count} раз(а) — нужны en/lt/he`);

console.log('youtube-off: OK');
