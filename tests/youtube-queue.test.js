// YouTube-плейлисты: очередь треков поверх LibVLC.
// Цепочка не должна рассыпаться по одному месту — каждый её кусок ловится здесь:
// 1) хост умеет резолвить плейлисты и аудио-потоки (yt-dlp),
// 2) хост шлёт событие nativeEnded по естественному концу трека,
// 3) страница слушает это событие и двигает очередь,
// 4) у станции-плейлиста свой путь запуска и своя остановка.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

// ——— Хост (C#) ———
// Резолвер — yt-dlp.exe (YtDlp.cs): YouTubeExplode убрана 2026-10-09,
// у неё сплошные 403 на каждый резолв («Не удалось воспроизвести плейлист»,
// app.log), yt-dlp на том же канале отдаёт и список, и прямую ссылку (~3 с).
const csproj = read('CatLuRadio.csproj');
if (csproj.includes('YoutubeExplode')) {
  throw new Error('YouTubeExplode вернулась в csproj — резолв должен идти через yt-dlp');
}
if (!csproj.includes('yt-dlp.exe')) {
  throw new Error('В CatLuRadio.csproj не подключён yt-dlp.exe — хост не сможет резолвить YouTube');
}
const ytdlp = read('YtDlp.cs');
for (const marker of ['RunAsync', 'EnsureAsync', 'CreateNoWindow = true']) {
  if (!ytdlp.includes(marker)) throw new Error(`В YtDlp.cs нет "${marker}"`);
}

const main = read('MainForm.cs');
for (const marker of ['case "resolveYoutubePlaylist"', 'case "resolveYoutubeTrack"', 'EndReached', 'nativeEnded', 'YtDlp.RunAsync']) {
  if (!main.includes(marker)) throw new Error(`В MainForm.cs нет "${marker}"`);
}
if (!main.includes('"bestaudio/best"')) {
  throw new Error('ResolveYoutubeTrack не выбирает аудио-поток — очередь не сможет запустить трек');
}

// ——— Мост (api-adapter) ———
const adapter = read('wwwroot', 'js', 'api-adapter.js');
for (const marker of ['resolveYoutubePlaylist', 'resolveYoutubeTrack', 'onHostEvent', "host:'"]) {
  if (!adapter.includes(marker)) throw new Error(`В api-adapter.js нет "${marker}"`);
}

// ——— Страница (renderer) ———
const renderer = read('wwwroot', 'js', 'renderer.js');
for (const marker of ['youtube-playlist', 'playYoutubeStation', 'playYoutubeTrack', 'handleNativeEnded', 'ytQueue = null']) {
  if (!renderer.includes(marker)) throw new Error(`В renderer.js нет "${marker}"`);
}
// Остановка обязана гасить очередь, иначе nativeEnded после stop перезапустит трек
const stopPlayBody = renderer.match(/function stopPlay\(\) \{[\s\S]*?\n\}/);
if (!stopPlayBody || !stopPlayBody[0].includes('ytQueue = null')) {
  throw new Error('stopPlay() не сбрасывает state.ytQueue — очередь оживёт после остановки');
}

// ——— Устойчивость после первого трека (фикс 2026-10-08) ———
// Тогда очередь умирала после первой песни: у window.AppAPI не было привязки
// setNativeEqualizer (только в WebView2API), TypeError обрывал playYoutubeTrack
// до сброса isSwitching — handleNativeEnded отбрасывался по guard'у, а
// playYoutubeStation молча не стартовал. Каждая часть цепочки ниже обязательна.
const adapterFacade = [
  'setNativeEqualizer: (values) => WebView2API.setNativeEqualizer(values)',
  'onNativeError: (handler) => WebView2API.onHostEvent'
];
for (const marker of adapterFacade) {
  if (!adapter.includes(marker)) throw new Error(`В фасаде AppAPI нет "${marker}"`);
}
if (!renderer.includes('catch (e) { console.warn(\'Эквалайзер LibVLC не применился:\', e); }')) {
  throw new Error('Сбой эквалайзера фатален — playYoutubeTrack оборвётся до сброса isSwitching');
}
if (!renderer.includes('YouTube: сбой запуска трека') ||
    !/if \(started\) \{[\s\S]{0,200}?state\.isSwitching = false;/.test(renderer)) {
  throw new Error('Внешний catch playYoutubeTrack не разблокирует isSwitching — очередь навечно зависнет');
}
if (!renderer.includes('function handleNativeError') ||
    !renderer.includes('register(\'onNativeError\', handleNativeError)')) {
  throw new Error('Страница не обрабатывает событие nativeError — после обрыва потока кнопка Play молчит');
}
if (!main.includes('nativeError') || !main.includes('OnNativeError')) {
  throw new Error('MainForm.cs не пробрасывает EncounteredError на страницу как nativeError');
}
// Кнопка Play после останови очереди должна перезапускать станцию, а не
// молча ничего не делать («больше не запускается»).
if (!renderer.includes('Не удалось перезапустить станцию')) {
  throw new Error('togglePlay() не перезапускает станцию, когда плеер встал');
}

// Раздел «YouTube» в списке станций: добавленные плейлисты не должны
// висеть в «Другая» — у них свой раздел, первым в списке.
if (!renderer.includes('const isYoutubeStation = station =>') ||
    !renderer.includes('groups.push([\'YouTube\', ytStations]')) {
  throw new Error('В renderStations нет отдельного раздела «YouTube» для yt-станций');
}

// ——— Один экземпляр на каталог данных ———
// Две живые копии делили один store_v2.json (вторая затирала станции первой,
// включая добавленные YouTube-плейлисты) и играли одновременно — отсюда
// «плавающая громкость» из-за биений двух потоков одной станции.
const program = read('Program.cs');
for (const marker of ['SingleInstanceName', 'isFirstInstance', 'FocusExistingInstance', 'GC.KeepAlive(singleInstanceMutex)']) {
  if (!program.includes(marker)) throw new Error(`В Program.cs нет "${marker}" — защита от двух экземпляров не работает`);
}
// SLAVA_UKRAINI обходил региональную блокировку Deorcify из YouTubeExplode —
// вместе с пакетом ушла и переменная (иначе в коде мёртвый обход).
if (program.includes('SLAVA_UKRAINI')) {
  throw new Error('SLAVA_UKRAINI остался в Program.cs — обход Deorcify нужен был только YouTubeExplode');
}

// ——— Разметка и переводы ———
const html = read('wwwroot', 'index.html');
if (!html.includes('addYtPlaylistBtn') || !html.includes('ytPlaylistUrl')) {
  throw new Error('В index.html нет формы добавления YouTube-плейлиста');
}

const tm = read('wwwroot', 'modules', 'TranslationManager.js');
for (const lang of ['Add playlist', 'Pridėti grojaraštį', 'הוספת רשימת השמעה']) {
  if (!tm.includes(lang)) throw new Error(`В TranslationManager.js нет перевода «${lang}»`);
}

console.log('YouTube queue: OK (resolve + nativeEnded + очередь + форма + переводы)');
