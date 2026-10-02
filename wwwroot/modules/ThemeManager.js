// Модуль управления темами
const ThemeManager = {
  currentTheme: 'system',

  /**
   * Применить тему
   * @param {string} theme - Название темы (light, dark, system)
   */
  applyTheme(theme) {
    this.currentTheme = theme;
    let actualTheme = theme;
    
    if (theme === 'system') {
      // Определить системную тему
      const prefersDark = window.matchMedia && 
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      actualTheme = prefersDark ? 'dark' : 'light';
      
      // Слушать изменения системной темы
      if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e) => {
          if (this.currentTheme === 'system') {
            this.applyTheme('system');
          }
        };
        
        // Удалить старый обработчик если есть
        if (mediaQuery.removeEventListener) {
          mediaQuery.removeEventListener('change', handler);
        }
        
        // Добавить новый обработчик
        if (mediaQuery.addEventListener) {
          mediaQuery.addEventListener('change', handler);
        } else {
          mediaQuery.addListener(handler);
        }
      }
    }
    
    document.documentElement.setAttribute('data-theme', actualTheme);
  },

  /**
   * Получить текущую тему
   * @returns {string} Текущая тема
   */
  getCurrentTheme() {
    return this.currentTheme;
  }
};

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeManager;
} else {
  window.ThemeManager = ThemeManager;
}

