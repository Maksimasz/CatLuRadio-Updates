// Сохранённые станции обязаны переживать перезапуск.
//
// Пойманный баг: хранилище затиралось предустановленными при каждом старте
// (loadStations писал в файл ДО того, как loadData успевал прочитать список),
// а чистка выкидывала всё, что не совпадает с id из stations.js — в частности,
// YouTube-плейлисты «yt-». Симптом: добавил станцию — она есть до выключения,
// при следующем запуске пропала, хотя избранное и история остались.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

// ——— Модуль чистки: проверяем поведением, а не строками ———
const StationCleanup = require(path.join(root, 'wwwroot', 'js', 'station-cleanup.js'));

// Пользовательские: ручное/онлайн-поиск (user-), импорт, YouTube-плейлисты
for (const id of ['user-1', 'imported_1', 'user-online-radio-1', 'yt-1791443770756']) {
  assert.ok(
    StationCleanup.isUserAdded({ id }, new Set()),
    `${id} должна считаться пользовательской и не выкидываться чисткой`
  );
}

// Старый предустановленный (id не из stations.js) — под чистку
assert.ok(
  !StationCleanup.isUserAdded({ id: 'rb-1' }, new Set()),
  'старый предустановленный должен уходить в «старые»'
);

// Любая избранная станция под защитой, даже с нестандартным id
assert.ok(
  StationCleanup.isUserAdded({ id: 'preview-online-x' }, new Set(['preview-online-x'])),
  'избранная станция обязана быть под защитой — иначе избранное станет ссылкой в никуда'
);

// Дедупликация: при конфликте URL побеждает пользовательская станция
{
  const preset = { id: 'rb-1', url: 'https://stream.example/one' };
  const user = { id: 'user-online-1', url: 'https://stream.example/one' };
  const result = StationCleanup.dedupe([preset, user], new Set());
  assert.deepStrictEqual(
    result.stations.map(s => s.id),
    ['user-online-1'],
    'должна остаться пользовательская станция, а не предустановленная'
  );
  assert.strictEqual(result.dropped, 1);
}

// Обычный дубль без пользовательских — побеждает первый, как раньше
{
  const a = { id: 'x', url: 'u' };
  const b = { id: 'y', url: 'u' };
  const result = StationCleanup.dedupe([a, b], new Set());
  assert.deepStrictEqual(result.stations.map(s => s.id), ['x']);
}

// YouTube-плейлист не конфликтует и сохраняется, порядок списка не меняется
{
  const preset = { id: 'rb-1', url: 'https://a.example/1' };
  const yt = { id: 'yt-1', url: 'https://youtube.com/playlist?list=ABC' };
  const preset2 = { id: 'rb-2', url: 'https://a.example/2' };
  const result = StationCleanup.dedupe([preset, yt, preset2], new Set());
  assert.deepStrictEqual(
    result.stations.map(s => s.id),
    ['rb-1', 'yt-1', 'rb-2'],
    'порядок и чужие станции должны сохраняться'
  );
}

// ——— Страница (renderer) ———
const renderer = read('wwwroot', 'js', 'renderer.js');

// 1) loadStations больше не пишет в хранилище: именно его запись на
//    DOMContentLoaded (до loadData) затирала сохранённый список.
const loadStationsBody = renderer.match(/function loadStations\(\) \{[\s\S]*?\n\}/);
assert.ok(loadStationsBody, 'loadStations не найдена');
assert.ok(
  !loadStationsBody[0].includes('saveStations'),
  'loadStations не должна писать в хранилище — затрёт сохранённые станции до loadData'
);

// 2) Чистка в loadData идёт через StationCleanup во всех трёх фильтрах
assert.ok(
  renderer.includes('StationCleanup.dedupe('),
  'loadData не использует StationCleanup.dedupe — дубликаты снова выберут проигравшего'
);
const keepFilter = 'StationCleanup.isUserAdded(s, favoriteIds) && !defaultIds.has(s.id)';
assert.ok(
  renderer.split(keepFilter).length - 1 >= 2,
  'фильтры сохранения пользовательских станций должны использовать StationCleanup'
);
assert.ok(
  renderer.includes('!StationCleanup.isUserAdded(s, favoriteIds)'),
  'фильтр старых предустановленных должен исключать пользовательские'
);

// 3) YouTube-станции редактируются/удаляются как пользовательские
assert.ok(
  renderer.includes("startsWith('yt-')"),
  'isUserStation не знает про yt- — YouTube-плейлист нельзя будет удалить'
);

// 4) Восстановление пропавшей избранной станции из истории
assert.ok(
  renderer.includes('Восстановлено из истории по избранному'),
  'нет восстановления станций из истории по избранному — старые потери не залечатся'
);

// ——— Разметка: модуль подключён до renderer ———
const html = read('wwwroot', 'index.html');
const cleanupTag = html.indexOf('station-cleanup.js');
assert.ok(cleanupTag !== -1, 'в index.html не подключён station-cleanup.js');
assert.ok(
  cleanupTag < html.indexOf('js/renderer.js'),
  'station-cleanup.js должен подключаться до renderer.js'
);

console.log('Stations persistence: OK (чистка не затирает, дубликаты в пользу пользователя, избранное восстанавливается)');
