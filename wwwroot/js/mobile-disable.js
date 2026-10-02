// Отключение функций для мобильной версии
// Этот файл переопределяет функции, которые не должны работать в мобильной версии

(function() {
  'use strict';
  
  // Проверяем, что это мобильная версия (запущена через index-mobile.html)
  function isMobileVersion() {
    return !document.getElementById('sortSelect') && 
           !document.querySelector('[data-tab="settings"]') &&
           !document.getElementById('minimizePlayerBtn');
  }
  
  // Ждем загрузки DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileDisable);
  } else {
    initMobileDisable();
  }
  
  function initMobileDisable() {
    if (!isMobileVersion()) {
      return; // Это не мобильная версия, ничего не делаем
    }
    
    console.log('Мобильная версия: отключение ненужных функций...');
    
    // Переопределяем функции, чтобы они ничего не делали
    window.addStation = function() {
      console.log('Добавление станций недоступно в мобильной версии');
    };
    
    window.editStation = function() {
      console.log('Редактирование станций недоступно в мобильной версии');
    };
    
    window.deleteStation = function() {
      console.log('Удаление станций недоступно в мобильной версии');
    };
    
    window.exportStations = function() {
      console.log('Экспорт станций недоступен в мобильной версии');
    };
    
    window.importStations = function() {
      console.log('Импорт станций недоступен в мобильной версии');
    };
    
    window.saveSettings = function() {
      console.log('Настройки недоступны в мобильной версии');
    };
    
    window.toggleMiniPlayer = function() {
      console.log('Мини-плеер недоступен в мобильной версии');
      return;
    };
    
    window.extractTuneInStream = function() {
      console.log('Извлечение потоков недоступно в мобильной версии');
    };
    
    window.extractRadioPotokStream = function() {
      console.log('Извлечение потоков недоступно в мобильной версии');
    };
    
    // Удаляем обработчики событий для элементов, которых нет в мобильной версии
    setTimeout(() => {
      const elementsToDisable = [
        'addStationBtn',
        'updateStationBtn',
        'cancelEditBtn',
        'exportBtn',
        'importBtn',
        'saveSettingsBtn',
        'extractTuneInBtn',
        'extractRadioPotokBtn',
        'minimizePlayerBtn',
        'sortSelect'
      ];
      
      elementsToDisable.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          // Заменяем обработчики на пустые функции
          el.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log(`Элемент ${id} недоступен в мобильной версии`);
            return false;
          };
        }
      });
      
      // Удаляем кнопки редактирования/удаления из станций
      document.querySelectorAll('[data-action="edit-station"], [data-action="delete-station"]').forEach(btn => {
        btn.remove();
      });
      
      console.log('Мобильная версия: функции отключены');
    }, 100);
  }
})();

