// Модуль сортировки станций
const StationSorter = {
  /**
   * Сортировать станции
   * @param {Array} stations - Массив станций
   * @param {string} sortType - Тип сортировки (name, genre, country)
   * @returns {Array} Отсортированный массив станций
   */
  sort(stations, sortType) {
    const sorted = [...stations];
    
    switch (sortType) {
      case 'name':
        return this.sortByName(sorted);
      case 'genre':
        return this.sortByGenre(sorted);
      case 'country':
        return this.sortByCountry(sorted);
      default:
        return this.sortByName(sorted);
    }
  },

  /**
   * Сортировка по названию
   */
  sortByName(stations) {
    return stations.sort((a, b) => {
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return nameA.localeCompare(nameB, 'ru');
    });
  },

  /**
   * Сортировка по жанру
   */
  sortByGenre(stations) {
    return stations.sort((a, b) => {
      const genreA = (a.genre || '').toLowerCase();
      const genreB = (b.genre || '').toLowerCase();
      if (genreA !== genreB) {
        return genreA.localeCompare(genreB, 'ru');
      }
      // Если жанры одинаковые, сортируем по названию
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return nameA.localeCompare(nameB, 'ru');
    });
  },

  /**
   * Сортировка по стране
   */
  sortByCountry(stations) {
    return stations.sort((a, b) => {
      const countryA = window.CountryNames?.getName(a.country || '') || a.country || '';
      const countryB = window.CountryNames?.getName(b.country || '') || b.country || '';
      if (countryA !== countryB) {
        return countryA.localeCompare(countryB, 'ru');
      }
      // Если страны одинаковые, сортируем по названию
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return nameA.localeCompare(nameB, 'ru');
    });
  }
};

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StationSorter;
} else {
  window.StationSorter = StationSorter;
}

