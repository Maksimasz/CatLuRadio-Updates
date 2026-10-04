// Единственный источник версии — <Version> в CatLuRadio.csproj. Всё остальное
// обязано с ним совпадать: ?v= в index.html бьёт кеш WebView2 (при несовпадении
// после обновления страница продолжает грузить старый renderer.js), а диалог
// «О программе» просто показывает неверную цифру.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

const csproj = fs.readFileSync(path.join(root, 'CatLuRadio.csproj'), 'utf8');
const versionMatch = csproj.match(/<Version>([^<]+)<\/Version>/);
if (!versionMatch) throw new Error('В CatLuRadio.csproj нет <Version>');
const version = versionMatch[1].trim();

const index = fs.readFileSync(path.join(root, 'wwwroot', 'index.html'), 'utf8');
const cacheRefs = [...index.matchAll(/\?v=([0-9][0-9.]*)/g)].map((m) => m[1]);
if (cacheRefs.length === 0) throw new Error('В index.html не осталось ни одного ?v= — кеш перестанет сбрасываться');
const stale = cacheRefs.filter((v) => v !== version);
if (stale.length > 0) {
  throw new Error(`index.html ссылается на версию ${stale.join(', ')}, а приложение ${version}: после обновления отдаст старый JS из кеша`);
}

const renderer = fs.readFileSync(path.join(root, 'wwwroot', 'js', 'renderer.js'), 'utf8');
const about = renderer.match(/CatLu Radio(?: NET)? v([0-9]+(?:\.[0-9]+)+)/);
if (about && about[1] !== version) {
  throw new Error(`Диалог «О программе» показывает v${about[1]}, а приложение ${version}`);
}

console.log(`Versions: OK (${version}, ссылок ?v=: ${cacheRefs.length}${about ? ', «О программе» совпадает' : ''})`);
