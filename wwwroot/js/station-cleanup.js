// Чистка списка станций при старте — чистые функции, чтобы их можно было
// проверить в tests/stations-persistence.test.js.
//
// Два правила, из-за нарушения которых сохранённые станции пропадали
// после перезапуска:
// 1) «Пользовательская» — всё, что добавил владелец: ручное добавление
//    и онлайн-поиск (user-), импорт (imported_), YouTube-плейлисты (yt-),
//    а также любая станция из избранного — избранное хранит только id,
//    и пропавшая станция оставляет ссылку в никуда.
// 2) При дубликатах по id или URL выигрывает пользовательская станция,
//    а не предустановленная: старая логика выбрасывала пользовательскую
//    копию, а следующей чисткой удаляла и предустановленную —
//    терялись обе.
const StationCleanup = (function () {
  // Префиксы id, под которыми хранятся станции, добавленные пользователем.
  const USER_ID_PREFIXES = ['user-', 'imported_', 'yt-'];

  // Пользовательская станция — или избранная? Чистка такие не трогает.
  function isUserAdded(station, favoriteIds) {
    const id = station && station.id;
    if (!id) return false;
    if (USER_ID_PREFIXES.some(prefix => id.startsWith(prefix))) return true;
    return !!(favoriteIds && typeof favoriteIds.has === 'function' && favoriteIds.has(id));
  }

  // Дедупликация по id и по URL с приоритетом пользовательских станций.
  // Порядок списка сохраняется; dropped — сколько дубликатов отброшено.
  function dedupe(stations, favoriteIds) {
    const dropped = new Set();
    const byId = new Map();
    const byUrl = new Map();

    // Выбросить станцию и освободить её ключи: id освободившейся станции
    // сможет занять следующая, а не уйдёт вместе с ней.
    const drop = (station) => {
      dropped.add(station);
      for (const [key, holder] of byId) if (holder === station) byId.delete(key);
      for (const [key, holder] of byUrl) if (holder === station) byUrl.delete(key);
    };

    for (const station of stations) {
      const id = station.id || '';
      const url = String(station.url || '').toLowerCase().trim();
      const idHolder = id ? byId.get(id) : undefined;
      const urlHolder = url ? byUrl.get(url) : undefined;
      const holders = [idHolder, urlHolder].filter(Boolean);

      if (!holders.length) {
        if (id) byId.set(id, station);
        if (url) byUrl.set(url, station);
        continue;
      }

      // Пользовательская выигрывает, только если все, с кем она конфликтует,
      // — предустановленные. Между собой пользовательские побеждает первый.
      const wins = isUserAdded(station, favoriteIds)
        && holders.every(holder => !isUserAdded(holder, favoriteIds));
      if (wins) {
        holders.forEach(drop);
        if (id) byId.set(id, station);
        if (url) byUrl.set(url, station);
      } else {
        dropped.add(station);
      }
    }

    return {
      stations: stations.filter(station => !dropped.has(station)),
      dropped: dropped.size
    };
  }

  return { USER_ID_PREFIXES, isUserAdded, dedupe };
})();

// Классический скрипт: браузеру — глобальный модуль, Node — на экспорт
// для тестов (тот же приём, что у stations.js и TranslationManager.js).
if (typeof window !== 'undefined') window.StationCleanup = StationCleanup;
if (typeof module !== 'undefined' && module.exports) module.exports = StationCleanup;
