// Модуль управления переводами
const TranslationManager = {
  translations: {
    ru: {
      nowPlaying: 'Сейчас играет',
      searchPlaceholder: 'Поиск станций...',
      allCountries: 'Все страны',
      favoritesEmpty: 'Нет избранных станций. Добавьте станции в избранное из списка станций.',
      addStation: 'Добавить свою станцию',
      stationName: 'Название станции',
      stationUrl: 'URL потока',
      country: 'Страна',
      genre: 'Жанр',
      addBtn: 'Добавить станцию',
      settings: 'Настройки',
      language: 'Язык интерфейса',
      minimizeToTray: 'Сворачивать в трей при закрытии окна',
      startMinimized: 'Запускать свернутым',
      saveSettings: 'Сохранить настройки',
      stationAdded: 'Станция успешно добавлена!',
      stationError: 'Ошибка: заполните все поля',
      settingsSaved: 'Настройки сохранены!',
      playing: 'Воспроизведение',
      paused: 'Пауза',
      stopped: 'Остановлено'
    },
    en: {
      nowPlaying: 'Now Playing',
      searchPlaceholder: 'Search stations...',
      allCountries: 'All Countries',
      favoritesEmpty: 'No favorite stations. Add stations to favorites from the stations list.',
      addStation: 'Add Your Station',
      stationName: 'Station Name',
      stationUrl: 'Stream URL',
      country: 'Country',
      genre: 'Genre',
      addBtn: 'Add Station',
      settings: 'Settings',
      language: 'Interface Language',
      minimizeToTray: 'Minimize to tray when closing window',
      startMinimized: 'Start minimized',
      saveSettings: 'Save Settings',
      stationAdded: 'Station added successfully!',
      stationError: 'Error: fill in all fields',
      settingsSaved: 'Settings saved!',
      playing: 'Playing',
      paused: 'Paused',
      stopped: 'Stopped'
    },
    fr: {
      nowPlaying: 'En cours de lecture',
      searchPlaceholder: 'Rechercher des stations...',
      allCountries: 'Tous les pays',
      favoritesEmpty: 'Aucune station favorite. Ajoutez des stations aux favoris depuis la liste des stations.',
      addStation: 'Ajouter votre station',
      stationName: 'Nom de la station',
      stationUrl: 'URL du flux',
      country: 'Pays',
      genre: 'Genre',
      addBtn: 'Ajouter la station',
      settings: 'Paramètres',
      language: 'Langue de l\'interface',
      minimizeToTray: 'Réduire dans la barre des tâches lors de la fermeture',
      startMinimized: 'Démarrer réduit',
      saveSettings: 'Enregistrer les paramètres',
      stationAdded: 'Station ajoutée avec succès!',
      stationError: 'Erreur: remplissez tous les champs',
      settingsSaved: 'Paramètres enregistrés!',
      playing: 'Lecture',
      paused: 'En pause',
      stopped: 'Arrêté'
    }
  },

  currentLanguage: 'ru',

  /**
   * Получить перевод по ключу
   * @param {string} key - Ключ перевода
   * @returns {string} Переведенный текст
   */
  t(key) {
    return this.translations[this.currentLanguage]?.[key] || 
           this.translations.ru[key] || 
           key;
  },

  /**
   * Установить язык
   * @param {string} lang - Код языка (ru, en, fr)
   */
  setLanguage(lang) {
    if (this.translations[lang]) {
      this.currentLanguage = lang;
    }
  },

  /**
   * Применить переводы к элементам интерфейса
   */
  applyTranslations() {
    const t = (key) => this.t(key);
    
    const nowPlayingLabel = document.querySelector('.now-playing-label');
    if (nowPlayingLabel) {
      nowPlayingLabel.textContent = t('nowPlaying') + ':';
    }
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.placeholder = t('searchPlaceholder');
    }
    
    const favoritesEmpty = document.querySelector('#favoritesEmpty');
    if (favoritesEmpty) {
      favoritesEmpty.textContent = t('favoritesEmpty');
    }
    
    const formTitle = document.querySelector('#add-tab h2');
    if (formTitle) {
      formTitle.textContent = t('addStation');
    }
  }
};

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TranslationManager;
} else {
  window.TranslationManager = TranslationManager;
}

