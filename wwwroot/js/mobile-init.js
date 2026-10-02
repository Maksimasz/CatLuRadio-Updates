// Инициализация мобильной версии для Capacitor
// Этот файл загружается только в Capacitor приложениях

(function() {
  'use strict';
  
  // Проверяем, что мы в Capacitor окружении
  if (typeof window === 'undefined' || !window.Capacitor) {
    return;
  }
  
  const Capacitor = window.Capacitor;
  
  // Инициализация происходит после загрузки DOM
  function initMobile() {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    
    // Инициализация статус-бара
    if (Capacitor.Plugins && Capacitor.Plugins.StatusBar) {
      try {
        Capacitor.Plugins.StatusBar.setStyle({ style: 'dark' });
        Capacitor.Plugins.StatusBar.setBackgroundColor({ color: '#6200ee' });
      } catch (err) {
        console.log('Не удалось настроить StatusBar:', err);
      }
    }
    
    // Обработка кнопки "Назад" на Android
    if (Capacitor.Plugins && Capacitor.Plugins.App) {
      Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
        if (!canGoBack) {
          Capacitor.Plugins.App.exitApp();
        } else {
          window.history.back();
        }
      });
      
      // Обработка паузы приложения
      Capacitor.Plugins.App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive && window.state && window.state.audio) {
          console.log('Приложение свернуто');
        }
      });
    }
    
    // Инициализация медиа-сессии для Android/iOS
    if ('mediaSession' in navigator) {
      const mediaSession = navigator.mediaSession;
      
      // Установка обработчиков действий медиа-сессии
      try {
        mediaSession.setActionHandler('play', () => {
          const playPauseBtn = document.getElementById('playPauseBtn');
          if (playPauseBtn && window.state && !window.state.isPlaying) {
            playPauseBtn.click();
          }
        });
        
        mediaSession.setActionHandler('pause', () => {
          const playPauseBtn = document.getElementById('playPauseBtn');
          if (playPauseBtn && window.state && window.state.isPlaying) {
            playPauseBtn.click();
          }
        });
        
        mediaSession.setActionHandler('stop', () => {
          const stopBtn = document.getElementById('stopBtn');
          if (stopBtn) {
            stopBtn.click();
          }
        });
        
        mediaSession.setActionHandler('previoustrack', () => {
          // Переключение на предыдущую станцию из истории
          if (window.state && window.state.history && window.state.history.length > 1) {
            const prevStation = window.state.history[window.state.history.length - 2];
            if (prevStation && window.playStation) {
              window.playStation(prevStation);
            }
          }
        });
        
        mediaSession.setActionHandler('nexttrack', () => {
          // Переключение на следующую станцию из истории
          if (window.state && window.state.history && window.state.history.length > 0) {
            const currentIndex = window.state.history.findIndex(s => 
              s.id === window.state.currentStation?.id
            );
            if (currentIndex >= 0 && currentIndex < window.state.history.length - 1) {
              const nextStation = window.state.history[currentIndex + 1];
              if (nextStation && window.playStation) {
                window.playStation(nextStation);
              }
            }
          }
        });
        
        console.log('Медиа-сессия инициализирована');
      } catch (err) {
        console.error('Ошибка инициализации медиа-сессии:', err);
      }
    }
    
    // Обработка медиа-кнопок (для Android TV и пультов)
    if (Capacitor.getPlatform() === 'android') {
      document.addEventListener('keydown', (e) => {
        // MediaPlayPause (обычно пробел или медиа-кнопка)
        if (e.key === ' ' || e.key === 'MediaPlayPause' || e.code === 'MediaPlayPause') {
          e.preventDefault();
          const playPauseBtn = document.getElementById('playPauseBtn');
          if (playPauseBtn) {
            playPauseBtn.click();
          }
        }
        // MediaStop
        if (e.key === 'MediaStop' || e.code === 'MediaStop') {
          e.preventDefault();
          const stopBtn = document.getElementById('stopBtn');
          if (stopBtn) {
            stopBtn.click();
          }
        }
      });
    }
    
    console.log('Мобильная версия инициализирована');
  }
  
  // Инициализировать после загрузки DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobile);
  } else {
    // DOM уже загружен
    setTimeout(initMobile, 100);
  }
})();

