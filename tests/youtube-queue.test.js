// YouTube-плейлисты: очередь треков поверх LibVLC.
// Цепочка не должна рассыпаться по одному месту — каждый её кусок ловится здесь:
// 1) хост умеет резолвить плейлисты и аудио-потоки (YoutubeExplode),
// 2) хост шлёт событие nativeEnded по естественному концу трека,
// 3) страница слушает это событие и двигает очередь,
// 4) у станции-плейлиста свой путь запуска и своя остановка.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

// ——— Хост (C#) ———
const csproj = read('CatLuRadio.csproj');
if (!csproj.includes('YoutubeExplode')) {
  throw new Error('В CatLuRadio.csproj нет пакета YoutubeExplode — хост не сможет резолвить YouTube');
}

const main = read('MainForm.cs');
for (const marker of ['case "resolveYoutubePlaylist"', 'case "resolveYoutubeTrack"', 'EndReached', 'nativeEnded']) {
  if (!main.includes(marker)) throw new Error(`В MainForm.cs нет "${marker}"`);
}
if (!main.includes('GetAudioOnlyStreams')) {
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
