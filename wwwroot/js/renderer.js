// Предустановленные станции больше не используются отдельно
// Все станции хранятся в state.stations

// Состояние приложения
let state = {
  stations: [],
  favorites: [],
  history: [], // История прослушанных станций (последние 50)
  currentStation: null,
  audio: null,
  isPlaying: false,
  volume: 0.5, // Громкость по умолчанию 50%
  nativeAudio: false,
  isClosing: false,
  isStopping: false, // Флаг для отслеживания программной остановки
  isSwitching: false, // Флаг для предотвращения множественных переключений
  sleepTimer: null, // Таймер сна
  scheduler: null, // Планировщик
  schedulerLastTrigger: {}, // Последние срабатывания планировщика (для избежания повторных запусков)
  settings: {
    language: 'ru',
    minimizeToTray: true,
    startMinimized: false,
    editMode: false,
    theme: 'system',
    sortType: 'name', // Тип сортировки: name, genre, country
    miniPlayer: false, // Режим мини-плеера
    equalizer: {
      enabled: true,
      values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      preset: 'normal'
    },
    crossfade: {
      enabled: true,
      duration: 2000 // Длительность перехода в миллисекундах
    },
    sleepTimer: {
      enabled: false,
      duration: 60 // Длительность в минутах
    },
    scheduler: {
      enabled: false,
      schedules: [] // Массив расписаний: [{time: "HH:MM", stationId: "...", days: [1,2,3,4,5], enabled: true}]
    }
  },
  equalizer: null, // Экземпляр эквалайзера
  audioContext: null, // AudioContext для crossfade
  fadeGainNode: null, // GainNode для управления громкостью при переходе
  oldAudioFadeGain: null, // GainNode для старого аудио при переходе
  hls: null // Экземпляр HLS.js для HLS потоков
};
state.stationHealth = {};
state.isRecoveringStream = false;

function rememberLastStation(station) {
  if (!station || station.preview) return;
  state.settings.lastStationId = station.id;
  window.AppAPI.saveSettings({ ...state.settings, volume: state.volume });
}

function clearLastStation() {
  if (!state.settings.lastStationId) return;
  state.settings.lastStationId = null;
  window.AppAPI.saveSettings({ ...state.settings, volume: state.volume });
}

// Используем модуль переводов
const t = (key) => {
  if (window.TranslationManager) {
    return window.TranslationManager.t(key);
  }
  return key;
};

// Функция getDefaultStations() теперь находится в stations.js

// Функция для отображения критических ошибок (только в консоли)
function logError(message, error = null) {
  if (error) {
    console.error(message, error);
  } else {
    console.error(message);
  }
}

// Инициализация
async function init() {
  const initStartTime = performance.now();
  console.log('[INIT] Начало инициализации...');
  
  // Проверить загрузку модулей
  if (!window.getDefaultStations) {
    logError('ОШИБКА: stations.js не загружен! Проверьте порядок загрузки скриптов.');
    return;
  }

  if (!window.AppAPI) {
    logError('ОШИБКА: api-adapter.js не загружен! Проверьте порядок загрузки скриптов.');
    return;
  }

  // Загрузить данные из хранилища (включая предустановленные станции при первом запуске)
  try {
    const loadStart = performance.now();
    console.log('[INIT] Загрузка данных...');
    await loadData();
    console.log('[INIT] Загрузка данных завершена за', (performance.now() - loadStart).toFixed(0), 'мс');
  } catch (error) {
    logError('ОШИБКА загрузки данных:', error);
    return;
  }

  // Инициализировать UI
  const uiStart = performance.now();
  console.log('[INIT] Инициализация UI...');
  initUI();
  console.log('[INIT] Инициализация UI завершена за', (performance.now() - uiStart).toFixed(0), 'мс');

  // Загрузить станции
  const stationsStart = performance.now();
  console.log('[INIT] Загрузка станций...');
  loadStations();
  console.log('[INIT] Загрузка станций завершена за', (performance.now() - stationsStart).toFixed(0), 'мс');

  // Настроить обработчики событий
  console.log('[INIT] Настройка обработчиков событий...');
  setupEventListeners();

  // Настроить IPC слушатели
  console.log('[INIT] Настройка IPC слушателей...');
  setupIPCListeners();

  // Применить переводы
  console.log('[INIT] Применение переводов...');
  if (window.TranslationManager) {
    window.TranslationManager.applyTranslations();
  } else {
    applyTranslations();
  }

  console.log('[INIT] Инициализация завершена за', (performance.now() - initStartTime).toFixed(0), 'мс');
  checkForUpdates();

  // Даём WebView2 завершить инициализацию до старта потока.
  setTimeout(() => {
    autoPlayLastStation();
  }, 2000);

  setInterval(checkAllStations, 15 * 60 * 1000);
}

// Загрузка данных
async function loadData() {
  try {
    state.stations = await window.AppAPI.getStations();
    state.favorites = await window.AppAPI.getFavorites();
    state.history = await window.AppAPI.getHistory() || [];
    const savedSettings = await window.AppAPI.getSettings();
    if (savedSettings) {
      // Объединить настройки, сохраняя структуру вложенных объектов
      state.settings = {
        ...state.settings,
        ...savedSettings,
        lastStationId: savedSettings.lastStationId || state.settings.lastStationId, // Сохранить lastStationId
        equalizer: {
          ...state.settings.equalizer,
          ...(savedSettings.equalizer || {})
        },
        crossfade: {
          ...state.settings.crossfade,
          ...(savedSettings.crossfade || {})
        },
        sleepTimer: {
          ...state.settings.sleepTimer,
          ...(savedSettings.sleepTimer || {})
        },
        scheduler: {
          ...state.settings.scheduler,
          ...(savedSettings.scheduler || {})
        }
      };
      
      // Восстановить режим мини-плеера если он был активен
      if (state.settings.miniPlayer) {
        setTimeout(() => {
          toggleMiniPlayer();
        }, 100);
      }
    }
    
    // Загрузить сохраненную громкость или использовать по умолчанию 50%
    // Если громкость не сохранена или равна 1.0 (100%), устанавливаем 0.5 (50%)
    if (savedSettings && savedSettings.volume !== undefined && savedSettings.volume !== null && savedSettings.volume !== 1.0) {
      state.volume = savedSettings.volume;
    } else {
      // Установить 50% по умолчанию и сохранить
      state.volume = 0.5;
      if (savedSettings) {
        savedSettings.volume = 0.5;
        // Сохранить асинхронно, не блокируя загрузку
        window.AppAPI.saveSettings({
          ...savedSettings,
          volume: 0.5
        }).catch(err => {
          logError('Ошибка сохранения громкости по умолчанию:', err);
        });
      }
    }
    
    // Инициализировать планировщик если включен
    if (state.settings.scheduler?.enabled) {
      initScheduler();
    }
    
    // Проверить версию сохраненных станций
    const savedVersion = await window.AppAPI.getStationsVersion();
    const currentVersion = window.DEFAULT_STATIONS_VERSION || '1.0.2';
    
    // Получить функцию getDefaultStations из stations.js
    if (!window.getDefaultStations) {
      const errorMsg = 'getDefaultStations не найдена! Проверьте загрузку stations.js';
      logError(errorMsg);
      throw new Error(errorMsg);
    }
    
    const defaultStationsList = window.getDefaultStations();
    
    if (!defaultStationsList || defaultStationsList.length === 0) {
      const errorMsg = 'ОШИБКА: defaultStationsList пуст! Проверьте stations.js';
      logError(errorMsg);
      throw new Error(errorMsg);
    }
    
    const defaultIds = new Set(defaultStationsList.map(s => s.id));
    
    // ВСЕГДА использовать только станции из stations.js (из CatLu-radio-stations.json)
    // Это проверенные рабочие станции - других предустановленных быть не должно
    
    // Если станций нет (первый запуск) - загрузить предустановленные
    if (!state.stations || state.stations.length === 0) {
      // Убедиться что нет дубликатов
      const uniqueStations = [];
      const seenIds = new Set();
      for (const station of defaultStationsList) {
        if (station.id && !seenIds.has(station.id)) {
          seenIds.add(station.id);
          uniqueStations.push({ ...station });
        }
      }
      state.stations = uniqueStations;
      await window.AppAPI.saveStations(state.stations);
      await window.AppAPI.saveStationsVersion(currentVersion);
    }
    // Если версия изменилась или не установлена - ПРИНУДИТЕЛЬНО заменить все предустановленные
    else if (!savedVersion || savedVersion !== currentVersion) {
      // Сохранить ВСЕ пользовательские станции (те, что начинаются с 'user-' или 'imported_' и не входят в предустановленные)
      const userStations = state.stations.filter(s => 
        s.id && (s.id.startsWith('user-') || s.id.startsWith('imported_')) && !defaultIds.has(s.id)
      );
      
      console.log('Сохранение пользовательских станций при обновлении версии:', userStations.length);
      
      // Полностью заменить список: сначала проверенные предустановленные из JSON, потом пользовательские
      state.stations = [
        ...defaultStationsList.map(station => ({ ...station })),
        ...userStations
      ];
      
      // Сохранить обновленные станции и версию
      await window.AppAPI.saveStations(state.stations);
      await window.AppAPI.saveStationsVersion(currentVersion);
    }
    // Если версия совпадает, проверить на дубликаты и старые предустановленные станции
    else {
      // Проверить на дубликаты по ID и по URL
      const seenIds = new Set();
      const seenUrls = new Set();
      const uniqueStations = [];
      const duplicates = [];
      
      for (const station of state.stations) {
        // Проверка по ID
        if (station.id && seenIds.has(station.id)) {
          duplicates.push(station);
          continue;
        }
        
        // Проверка по URL (нормализованному)
        const normalizedUrl = station.url?.toLowerCase().trim();
        if (normalizedUrl && seenUrls.has(normalizedUrl)) {
          duplicates.push(station);
          continue;
        }
        
        // Станция уникальна
        if (station.id) seenIds.add(station.id);
        if (normalizedUrl) seenUrls.add(normalizedUrl);
        uniqueStations.push(station);
      }
      
      // Если есть дубликаты, удалить их
      if (duplicates.length > 0) {
        console.log(`Удалено дубликатов: ${duplicates.length}`);
        state.stations = uniqueStations;
        await window.AppAPI.saveStations(state.stations);
      }
      
      // Проверить, есть ли старые предустановленные станции, которых нет в новом списке
      // Исключаем пользовательские (user-) и импортированные (imported_) станции
      const oldDefaultStations = state.stations.filter(s => 
        s.id && !s.id.startsWith('user-') && !s.id.startsWith('imported_') && !defaultIds.has(s.id)
      );
      
      // Проверить, все ли предустановленные станции присутствуют
      const existingDefaultIds = new Set(state.stations.filter(s => defaultIds.has(s.id)).map(s => s.id));
      const missingDefaults = defaultStationsList.filter(s => !existingDefaultIds.has(s.id));
      
      if (oldDefaultStations.length > 0 || missingDefaults.length > 0) {
        // Оставить только проверенные предустановленные и пользовательские (включая импортированные)
        const userStations = state.stations.filter(s => 
          s.id && (s.id.startsWith('user-') || s.id.startsWith('imported_')) && !defaultIds.has(s.id)
        );
        
        console.log('Сохранение пользовательских станций при очистке старых предустановленных:', userStations.length);
        
        state.stations = [
          ...defaultStationsList.map(station => ({ ...station })),
          ...userStations
        ];
        
        await window.AppAPI.saveStations(state.stations);
        await window.AppAPI.saveStationsVersion(currentVersion);
      }
    }
  } catch (error) {
    logError('Error loading data:', error);
  }
}

// Сохранение данных
async function saveData() {
  try {
    await window.AppAPI.saveStations(state.stations);
    await window.AppAPI.saveFavorites(state.favorites);
    await window.AppAPI.saveHistory(state.history);
    // Сохранить громкость в настройках
    const settingsToSave = {
      ...state.settings,
      volume: state.volume
    };
    await window.AppAPI.saveSettings(settingsToSave);
    return true;
  } catch (error) {
    logError('Error saving data:', error);
    throw error;
  }
}

// Автоматический запуск последней играющей станции
async function autoPlayLastStation() {
  try {
    // Убедиться что станции загружены
    if (!state.stations || state.stations.length === 0) {
      setTimeout(() => {
        autoPlayLastStation();
      }, 500);
      return;
    }

    state.isSwitching = false;

    const savedSettings = await window.AppAPI.getSettings();
    const lastStationId = savedSettings?.lastStationId || state.settings?.lastStationId;

    if (lastStationId) {
      const lastStation = state.stations.find(s => s.id === lastStationId);
      if (lastStation) {
        console.log('Автозапуск:', lastStation.name);
        setTimeout(() => {
          state.isSwitching = false;
          playStation(lastStation).catch(err => {
            // Игнорируем ошибку autoplay - пользователь запустит сам
            console.log('Автостарт заблокирован (требуется клик):', err.message);
          });
        }, 300);
      }
    }
  } catch (error) {
    console.log('Ошибка автостарта:', error.message);
  }
}

// Добавление станции в историю
function addToHistory(station) {
  if (!station || !station.id) return;
  
  // Удалить станцию из истории если она уже там есть
  state.history = state.history.filter(h => h.id !== station.id);
  
  // Добавить в начало с временной меткой
  state.history.unshift({
    ...station,
    playedAt: new Date().toISOString()
  });
  
  // Ограничить историю до 50 записей
  if (state.history.length > 50) {
    state.history = state.history.slice(0, 50);
  }
  
  // Сохранить историю
  window.AppAPI.saveHistory(state.history).catch(err => {
    logError('Ошибка сохранения истории:', err);
  });
  
  // Обновить отображение истории если вкладка открыта
  if (document.querySelector('[data-tab="history"]')?.classList.contains('active')) {
    renderHistory();
  }
}

// Очистка истории
function clearHistory() {
  state.history = [];
  window.AppAPI.saveHistory(state.history).catch(err => {
    logError('Ошибка очистки истории:', err);
  });
  renderHistory();
}

// Рендеринг истории
function renderHistory() {
  const container = document.getElementById('historyList');
  const emptyMsg = document.getElementById('historyEmpty');
  
  if (!container) return;
  
  if (!state.history || state.history.length === 0) {
    container.innerHTML = '';
    if (emptyMsg) emptyMsg.style.display = 'block';
    return;
  }
  
  if (emptyMsg) emptyMsg.style.display = 'none';
  
  container.innerHTML = state.history.map((item, index) => {
    const station = state.stations.find(s => s.id === item.id) || item;
    const playedDate = new Date(item.playedAt);
    const timeStr = playedDate.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    return `
      <div class="station-item ${state.currentStation?.id === station.id && state.isPlaying ? 'playing' : ''}" 
           data-station-id="${escapeHtml(station.id)}">
        <div class="station-info">
          <div class="station-name">${escapeHtml(station.name)}</div>
          <div class="station-meta">
            <span>${escapeHtml(getCountryName(station.country))}</span>
            <span>•</span>
            <span>${escapeHtml(station.genre)}</span>
            <span>•</span>
            <span style="font-size: 0.85em; color: var(--md-on-surface-variant);">${timeStr}</span>
          </div>
        </div>
        <div class="station-actions">
          <button class="btn-icon btn-favorite ${isFavorite(station.id) ? 'active' : ''}" 
                  data-action="toggle-favorite" data-station-id="${escapeHtml(station.id)}" title="Избранное">
            ${isFavorite(station.id) ? '❤️' : '🤍'}
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  // Добавить обработчики кликов
  container.querySelectorAll('.station-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.btn-icon')) {
        const stationId = item.dataset.stationId;
        const station = state.stations.find(s => s.id === stationId) || state.history.find(h => h.id === stationId);
        if (station) {
          playStation(station);
        }
      }
    });
  });
  
  // Обработчики избранного
  container.querySelectorAll('[data-action="toggle-favorite"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stationId = btn.dataset.stationId;
      toggleFavorite(stationId);
    });
  });
}

// Инициализация UI
function initUI() {
  // Установить начальный объем
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  // Установить громкость из сохраненных настроек или по умолчанию 50%
  // Установить громкость из сохраненных настроек или по умолчанию 50%
  // Громкость уже должна быть загружена в loadData(), но на всякий случай проверяем
  const savedVolume = (state.volume !== undefined && state.volume !== null) ? state.volume : 0.5;
  // Если громкость равна 1.0 (100%), устанавливаем 0.5 (50%)
  const finalVolume = savedVolume === 1.0 ? 0.5 : savedVolume;
  state.volume = finalVolume;
  volumeSlider.value = finalVolume * 100;
  volumeValue.textContent = Math.round(finalVolume * 100) + '%';
  
  // Применить громкость к текущему аудио если оно играет
  if (state.audio) {
    state.audio.volume = finalVolume;
  }
  
  // Инициализировать часы
  initClock();
  
  // Установить язык
  document.getElementById('languageSelect').value = state.settings.language;
  if (window.TranslationManager) {
    window.TranslationManager.setLanguage(state.settings.language);
  }
  
  // Установить режим редактирования
  document.getElementById('editMode').checked = state.settings.editMode || false;
  
  // Установить тему
  document.getElementById('themeSelect').value = state.settings.theme || 'system';
  if (window.ThemeManager) {
    window.ThemeManager.applyTheme(state.settings.theme || 'system');
  } else {
    applyTheme(state.settings.theme || 'system');
  }
  
  // Установить сортировку
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.value = state.settings.sortType || 'name';
  }
  
  // Установить другие настройки
  document.getElementById('minimizeToTray').checked = state.settings.minimizeToTray !== false;
  document.getElementById('startMinimized').checked = state.settings.startMinimized || false;
  updatePlayButton();
  
  // Инициализировать эквалайзер (если модуль загружен)
  if (window.Equalizer) {
    initEqualizer();
  } else {
    // Попробовать еще раз после небольшой задержки
    setTimeout(() => {
      if (window.Equalizer) {
        initEqualizer();
      }
    }, 1000);
  }
}

// Загрузка станций
function loadStations() {
  // Проверить что станции загружены
  if (!state.stations || state.stations.length === 0) {
    logError('ВНИМАНИЕ: Нет станций для отображения! Количество станций: ' + (state.stations ? state.stations.length : 'undefined'));
    // Попробовать загрузить предустановленные станции
    if (window.getDefaultStations) {
      const defaultStations = window.getDefaultStations();
      if (defaultStations && defaultStations.length > 0) {
        state.stations = defaultStations;
        window.AppAPI.saveStations(state.stations).catch(err => {
          logError('Ошибка сохранения предустановленных станций:', err);
        });
      }
    }
  }
  
  renderStations(state.stations || []);
  renderFavorites();
}

// Используем модуль сортировки станций
function sortStations(stations, sortType) {
  if (window.StationSorter) {
    return window.StationSorter.sort(stations, sortType);
  }
  // Fallback на старую логику если модуль не загружен
  return stations.sort((a, b) => {
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    return nameA.localeCompare(nameB, 'ru');
  });
}

// Рендеринг списка станций
function renderStations(stations) {
  const container = document.getElementById('stationsList');
  
  if (!container) {
    logError('ОШИБКА: stationsList не найден в DOM!');
    return;
  }
  
  if (!stations || stations.length === 0) {
    container.innerHTML = '<p class="empty-message">Станции не найдены</p>';
    return;
  }
  
  
  const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const filterCountry = document.getElementById('filterSelect')?.value || 'all';
  const sortType = state.settings.sortType || 'name';
  
  // Фильтрация
  let filtered = stations;
  
  if (searchTerm) {
    filtered = filtered.filter(s => 
      normalizedStationName(s.name).includes(normalizedStationName(searchTerm))
    );
  }
  
  if (filterCountry !== 'all') {
    filtered = filtered.filter(s => s.country === filterCountry);
  }
  
  // Сортировка
  filtered = sortStations(filtered, sortType);
  
  if (filtered.length === 0) {
    container.innerHTML = '<p class="empty-message">Станции не найдены</p>';
    return;
  }
  
  const cards = group => group.map(station => `
    <div class="station-item ${state.currentStation?.id === station.id && state.isPlaying ? 'playing' : ''} ${state.stationHealth[station.id] === false ? 'offline' : ''}" 
         data-station-id="${escapeHtml(station.id)}">
      <div class="station-info">
        <div class="station-name">${escapeHtml(station.name)}</div>
        <div class="station-meta">
          <span>${escapeHtml(getCountryName(station.country))}</span>
          <span>•</span>
          <span>${escapeHtml(station.genre)}</span>
        </div>
      </div>
      <div class="station-actions">
        ${isUserStation(station.id) ? `
          <button class="btn-icon btn-edit" 
                  data-action="edit-station" data-station-id="${escapeHtml(station.id)}" title="Редактировать">
            ✏️
          </button>
          <button class="btn-icon btn-delete" 
                  data-action="delete-station" data-station-id="${escapeHtml(station.id)}" title="Удалить">
            🗑️
          </button>
        ` : ''}
        <button class="btn-icon btn-favorite ${isFavorite(station.id) ? 'active' : ''}" 
                data-action="toggle-favorite" data-station-id="${escapeHtml(station.id)}" title="Избранное">
          ${isFavorite(station.id) ? '❤️' : '🤍'}
        </button>
      </div>
    </div>
  `).join('');
  const countries = new Map();
  filtered.forEach(station => countries.set(station.country, [...(countries.get(station.country) || []), station]));
  container.innerHTML = [...countries]
    .sort(([a], [b]) => getCountryName(a).localeCompare(getCountryName(b), 'ru'))
    .map(([country, group], index) => `
      <details class="country-group" ${index === 0 ? 'open' : ''}>
        <summary>${escapeHtml(getCountryName(country))}<span>${group.length}</span></summary>
        ${cards(group)}
      </details>
    `).join('');
  container.querySelectorAll('.country-group').forEach(group => group.addEventListener('toggle', () => {
    if (group.open) container.querySelectorAll('.country-group').forEach(other => { if (other !== group) other.open = false; });
  }));
  
  // Добавить обработчики кликов
  container.querySelectorAll('.station-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.btn-icon')) {
        const stationId = item.dataset.stationId;
        const station = state.stations.find(s => s.id === stationId);
        if (station) {
          playStation(station);
        }
      }
    });
  });
  
  // Обработчики избранного
  container.querySelectorAll('[data-action="toggle-favorite"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stationId = btn.dataset.stationId;
      toggleFavorite(stationId);
    });
  });
  
  // Обработчики редактирования
  container.querySelectorAll('[data-action="edit-station"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stationId = btn.dataset.stationId;
      editStation(stationId);
    });
  });
  
  // Обработчики удаления
  container.querySelectorAll('[data-action="delete-station"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stationId = btn.dataset.stationId;
      deleteStation(stationId);
    });
  });
}

// Рендеринг избранного
function renderFavorites() {
  const container = document.getElementById('favoritesList');
  const emptyMsg = document.getElementById('favoritesEmpty');
  
  if (state.favorites.length === 0) {
    container.innerHTML = '';
    emptyMsg.style.display = 'block';
    return;
  }
  
  emptyMsg.style.display = 'none';
  
  // Все станции в state.stations, найти избранные
  let favoriteStations = state.favorites
    .map(id => state.stations.find(s => s.id === id))
    .filter(s => s);
  
  // Применить сортировку к избранному
  const sortType = state.settings.sortType || 'name';
  favoriteStations = sortStations(favoriteStations, sortType);
  
  container.innerHTML = favoriteStations.map(station => `
    <div class="station-item ${state.currentStation?.id === station.id && state.isPlaying ? 'playing' : ''}" 
         data-station-id="${escapeHtml(station.id)}">
      <div class="station-info">
        <div class="station-name">${escapeHtml(station.name)}</div>
        <div class="station-meta">
          <span>${escapeHtml(getCountryName(station.country))}</span>
          <span>•</span>
          <span>${escapeHtml(station.genre)}</span>
        </div>
      </div>
      <div class="station-actions">
        ${isUserStation(station.id) ? `
          <button class="btn-icon btn-edit" 
                  data-action="edit-station" data-station-id="${escapeHtml(station.id)}" title="Редактировать">
            ✏️
          </button>
          <button class="btn-icon btn-delete" 
                  data-action="delete-station" data-station-id="${escapeHtml(station.id)}" title="Удалить">
            🗑️
          </button>
        ` : ''}
        <button class="btn-icon btn-favorite active" 
                data-action="toggle-favorite" data-station-id="${escapeHtml(station.id)}" title="Избранное">
          ❤️
        </button>
      </div>
    </div>
  `).join('');
  
  // Добавить обработчики
  container.querySelectorAll('.station-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.btn-icon')) {
        const stationId = item.dataset.stationId;
        const station = state.stations.find(s => s.id === stationId);
        if (station) {
          playStation(station);
        }
      }
    });
  });
  
  container.querySelectorAll('[data-action="toggle-favorite"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stationId = btn.dataset.stationId;
      toggleFavorite(stationId);
    });
  });
  
  // Обработчики редактирования
  container.querySelectorAll('[data-action="edit-station"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stationId = btn.dataset.stationId;
      editStation(stationId);
    });
  });
  
  // Обработчики удаления
  container.querySelectorAll('[data-action="delete-station"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stationId = btn.dataset.stationId;
      deleteStation(stationId);
    });
  });
}

// Функция для плавного затухания (fade out) через volume
function fadeOutVolume(audioElement, duration, onComplete) {
  if (!audioElement) {
    if (onComplete) onComplete();
    return;
  }
  
  const startVolume = audioElement.volume;
  const steps = 20; // Количество шагов для плавности
  const stepDuration = duration / steps;
  const volumeStep = startVolume / steps;
  let currentStep = 0;
  
  const fadeInterval = setInterval(() => {
    currentStep++;
    const newVolume = Math.max(0, startVolume - (volumeStep * currentStep));
    audioElement.volume = newVolume;
    
    if (currentStep >= steps || newVolume <= 0) {
      clearInterval(fadeInterval);
      audioElement.volume = 0;
      if (onComplete) onComplete();
    }
  }, stepDuration);
  
  return fadeInterval;
}

// Функция для плавного нарастания (fade in) через volume
function fadeInVolume(audioElement, duration) {
  if (!audioElement) return;
  
  const targetVolume = state.volume;
  const steps = 20; // Количество шагов для плавности
  const stepDuration = duration / steps;
  const volumeStep = targetVolume / steps;
  let currentStep = 0;
  
  audioElement.volume = 0;
  
  const fadeInterval = setInterval(() => {
    currentStep++;
    const newVolume = Math.min(targetVolume, volumeStep * currentStep);
    audioElement.volume = newVolume;
    
    if (currentStep >= steps || newVolume >= targetVolume) {
      clearInterval(fadeInterval);
      audioElement.volume = targetVolume;
    }
  }, stepDuration);
  
  return fadeInterval;
}

// Воспроизведение станции
async function playStation(station) {
  // Защита от множественных переключений
  if (state.isSwitching) {
    return;
  }
  
  // Если пытаемся запустить ту же станцию - ничего не делать
  if (state.currentStation && state.currentStation.id === station.id && state.isPlaying) {
    return;
  }
  
  // Установить флаг переключения
  state.isSwitching = true;

  await window.AppAPI.stopNative();
  state.nativeAudio = false;

  const crossfadeEnabled = state.settings.crossfade && state.settings.crossfade.enabled;
  const crossfadeDuration = state.settings.crossfade ? state.settings.crossfade.duration : 2000;
  const useCrossfade = crossfadeEnabled && state.audio && state.isPlaying;
  
  // Сохранить ссылку на старое аудио для crossfade
  const oldAudio = state.audio;
  
  // Обновить информацию о текущей станции сразу
  state.currentStation = station;
  updateNowPlaying(station.name);
  state.isPlaying = false;
  updatePlayButton();
  
  // Если есть старое аудио и не используется crossfade - остановить сразу
  if (oldAudio && !useCrossfade) {
    state.isStopping = true;
    try {
      oldAudio.pause();
      oldAudio.src = '';
      oldAudio.load();
    } catch (e) {
      // Игнорировать ошибки
    }
    state.audio = null;
    state.isStopping = false;
  } else if (oldAudio && useCrossfade) {
    // При crossfade освобождаем ссылку, но старое аудио продолжит играть
    // Fade out начнется когда новое аудио начнет играть
    state.audio = null;
  }
  
  // Проверить валидность URL
  if (!station.url || !station.url.trim()) {
    state.isSwitching = false;
    alert('Ошибка: не указан URL станции');
    return;
  }
  
  let streamUrl = station.url.trim();
  if (station.source === 'RLive' && streamUrl === 'https://rs.mizrahit.fm:7777/;stream') {
    streamUrl = station.url = 'https://rs.mizrahit.fm/';
  }
  
  try {
    // Проверить формат URL
    new URL(streamUrl);
  } catch (e) {
    state.isSwitching = false;
    alert('Ошибка: неверный формат URL станции');
    return;
  }

  // LibVLC — основной движок: он ждёт начало вывода звука. При неудаче ниже
  // сохраняется прежний браузерный путь как совместимый резерв.
  if (!crossfadeEnabled) {
    if (state.hls) {
      try { state.hls.stopLoad(); state.hls.detachMedia(); state.hls.destroy(); } catch (e) {}
      state.hls = null;
    }
    const nativeResult = await window.AppAPI.playNative(streamUrl, state.volume);
    if (nativeResult?.success) {
      state.nativeAudio = true;
      await window.AppAPI.setNativeEqualizer(state.settings.equalizer?.values || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      state.isPlaying = true;
      rememberLastStation(station);
      state.isSwitching = false;
      updatePlayButton();
      renderStations(state.stations);
      renderFavorites();
      return;
    }
  }

  // Резервный путь: LibVLC не запустил поток или включён кроссфейд —
  // дальше воспроизведение идёт через <audio>/HLS/Web Audio в самой странице.
  await playInBrowserPlayer({ station, streamUrl, oldAudio, useCrossfade, crossfadeDuration });
}


/**
 * Резервное воспроизведение в браузере: <audio>, HLS.js и Web Audio (эквалайзер).
 * Вызывается из playStation(), когда LibVLC не взял поток или когда нужен
 * кроссфейд — нативный плеер не умеет плавно переходить между станциями.
 */
/**
 * Определяет формат потока по расширению/параметрам URL и проверяет,
 * поддерживает ли браузер HLS. Чистая функция — ни состояния, ни побочных
 * эффектов, поэтому легко проверяется отдельно от воспроизведения.
 */
function detectStreamFormat(streamUrl) {
  const urlLower = streamUrl.toLowerCase();
  const isHLS = urlLower.includes('.m3u8') || urlLower.includes('.m3u');
  let contentType = '';

  if (urlLower.includes('.mp3') || urlLower.includes('/mp3') || urlLower.includes('type=mp3')) {
    contentType = 'audio/mpeg';
  } else if (urlLower.includes('.aac') || urlLower.includes('.aacp') || urlLower.includes('type=aac')) {
    contentType = 'audio/aac';
  } else if (urlLower.includes('.ogg') || urlLower.includes('type=ogg')) {
    contentType = 'audio/ogg';
  } else if (isHLS) {
    contentType = 'application/vnd.apple.mpegurl';
  } else if (urlLower.includes('.wav')) {
    contentType = 'audio/wav';
  }

  const hlsSupported = typeof Hls !== 'undefined' && Hls.isSupported();
  return { contentType, isHLS, hlsSupported, useHLS: isHLS && hlsSupported };
}

/**
 * Ошибка <audio>: сначала повторные загрузки, потом запасной запуск через LibVLC,
 * и только если всё не помогло — финальный отказ пользователю.
 * Вынесена отдельно: это самая ветвящаяся часть воспроизведения.
 *
 * retryState общий с handleStalled — оба следят за одним аудио-элементом.
 */
function createStreamErrorHandler({ station, streamUrl, audioElement, contentType, retryState }) {
  return async (e) => {
    // Не показывать ошибку если это программная остановка или элемент уже не активен
    if (state.isStopping || state.audio !== audioElement || state.isSwitching) {
      return;
    }
    if (state.isPlaying) return;
    
    const errorCode = audioElement.error?.code;
    const errorMessage = audioElement.error?.message || '';
    
    console.error('Audio error:', {
      code: errorCode,
      message: errorMessage,
      url: streamUrl,
      readyState: audioElement.readyState,
      networkState: audioElement.networkState
    });
    
    // Коды ошибок:
    // MEDIA_ERR_ABORTED (1) - загрузка прервана пользователем
    // MEDIA_ERR_NETWORK (2) - ошибка сети
    // MEDIA_ERR_DECODE (3) - ошибка декодирования
    // MEDIA_ERR_SRC_NOT_SUPPORTED (4) - формат не поддерживается
    
    if (errorCode === 1) {
      // Прервано пользователем - не показывать ошибку
      return;
    }
    
    // Для MP3 потоков попробовать перезагрузить с более длительной задержкой
    if (contentType === 'audio/mpeg' && retryState.retryCount < retryState.maxRetries) {
      retryState.retryCount++;
      console.log(`Попытка перезагрузки MP3 потока (попытка ${retryState.retryCount}/${retryState.maxRetries})`);
      
      // Очистить текущий источник
      audioElement.src = '';
      audioElement.load();
      
      // Подождать и попробовать снова с более длительной задержкой для MP3
      setTimeout(() => {
        if (!state.isStopping && !state.isPlaying && state.audio === audioElement) {
          audioElement.src = streamUrl;
          // Для MP3 дать больше времени на загрузку перед вызовом load()
          setTimeout(() => {
            if (!state.isStopping && !state.isPlaying && state.audio === audioElement) {
              audioElement.load();
            }
          }, 100);
        }
      }, 1500); // Увеличиваем задержку для MP3 потоков
      
      return; // Не показывать ошибку пока есть попытки
    }
    
    // Попробовать перезагрузить при ошибках сети или декодирования для других форматов
    if (retryState.retryCount < retryState.maxRetries && (errorCode === 2 || errorCode === 3 || errorCode === 4)) {
      retryState.retryCount++;
      // Попытка перезагрузки потока
      
      // Очистить текущий источник
      audioElement.src = '';
      audioElement.load();
      
      // Подождать и попробовать снова
      setTimeout(() => {
        if (!state.isStopping && !state.isPlaying && state.audio === audioElement) {
          audioElement.src = streamUrl;
          audioElement.load();
        }
      }, 1000); // Увеличиваем задержку для перезагрузки
      
      return; // Не показывать ошибку пока есть попытки
    }
    
    // Несколько error-событий могут прийти подряд, пока запланированная
    // повторная загрузка уже запускает звук. Решение об отключении станции
    // принимаем один раз и только после короткого периода стабилизации.
    if (retryState.terminalErrorPending) return;
    retryState.terminalErrorPending = true;
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (state.isPlaying || state.audio !== audioElement || state.isStopping) {
      retryState.terminalErrorPending = false;
      return;
    }

    // Поток может быть живым, но WebView2 не принимать старый HTTP/Icecast.
    // После сетевой проверки запускаем его проигрывателем Windows.
    const streamCheck = await window.AppAPI.checkStream(streamUrl);
    if (streamUrl.startsWith('http://') && streamCheck?.success) {
      const nativeResult = await window.AppAPI.playNative(streamUrl, state.volume);
      if (nativeResult?.success && state.audio === audioElement && !state.isStopping) {
        audioElement.src = '';
        state.audio = null;
        state.nativeAudio = true;
        state.isPlaying = true;
        state.currentStation = station;
        station.incompatible = false;
        state.stationHealth[station.id] = true;
        rememberLastStation(station);
        updateNowPlaying(station.name);
        updatePlayButton();
        if (!station.preview) addToHistory(station);
        renderStations(state.stations);
        renderFavorites();
        if (!station.preview) saveData();
        return;
      }
    }

    // Сбросить флаг переключения при ошибке
    state.isSwitching = false;
    
    let userErrorMessage = 'Ошибка загрузки станции: ' + station.name;
    if (errorCode === 2) {
      userErrorMessage += '\nПроблема с сетью. Проверьте подключение к интернету.';
    } else if (errorCode === 3) {
      userErrorMessage += '\nОшибка декодирования аудио. Возможно, формат не поддерживается.';
    } else if (errorCode === 4) {
      userErrorMessage += '\nПоток не удалось открыть или его формат не поддерживается.';
    } else {
      userErrorMessage += '\nКод ошибки: ' + errorCode;
      if (errorMessage) {
        userErrorMessage += '\n' + errorMessage;
      }
    }
    
    if (retryState.retryCount >= retryState.maxRetries && await tryRecoverStation(station, streamUrl)) return;
    state.isPlaying = false;
    state.audio = null;
    state.stationHealth[station.id] = false;
    state.currentStation = null;
    updateNowPlaying('—');
    renderStations(state.stations);
    saveData();
    alert(userErrorMessage + '\n\nРабочий резервный поток не найден.');
  };
}

/**
 * Вешает обработчики <audio> на элемент: обновление статуса, кроссфейд,
 * повторные загрузки и запуск через LibVLC при ошибке (см. createStreamErrorHandler).
 */
function bindAudioElementEvents({ station, streamUrl, audioElement, contentType, useCrossfade, crossfadeDuration, oldAudio, retryState }) {
  // Обработчики событий
  const handleLoadStart = () => {
    if (!state.isStopping && state.audio === audioElement) {
      updateNowPlaying(station.name);
    }
  };
  
  const handleCanPlay = () => {
    if (!state.isStopping && state.audio === audioElement) {
      // Начинать воспроизведение сразу без задержек
      if (audioElement.readyState >= 2) { // HAVE_CURRENT_DATA или выше
        // Если используется crossfade, начать с нулевой громкости
        if (useCrossfade) {
          audioElement.volume = 0;
        }
        
        // Начать воспроизведение немедленно
        audioElement.play().then(() => {
          // После начала воспроизведения запустить fade in если используется crossfade
          if (useCrossfade && audioElement.volume === 0) {
            fadeInVolume(audioElement, crossfadeDuration);
          }
        }).catch(error => {
          if (!state.isStopping) {
            console.error('Play error:', error, 'ReadyState:', audioElement.readyState);
            
            // Попробовать перезагрузить поток один раз
            if (audioElement.readyState < 2) {
              // Попытка перезагрузки потока
              audioElement.load();
              setTimeout(() => {
                if (!state.isStopping && state.audio === audioElement && audioElement.readyState >= 2) {
                  audioElement.play().catch(retryError => {
                    console.error('Retry play error:', retryError);
                    alert('Ошибка воспроизведения: ' + station.name + '\nПроверьте URL потока.');
                    state.isPlaying = false;
      // Обновить медиа-сессию
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'paused';
        } catch (e) {}
      }
                    state.currentStation = null;
                    state.isSwitching = false;
                    updatePlayButton();
                    updateNowPlaying('—');
                  });
                } else {
                  alert('Ошибка воспроизведения: ' + station.name + '\nПоток не загружается.');
                  state.isPlaying = false;
      // Обновить медиа-сессию
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'paused';
        } catch (e) {}
      }
                  state.currentStation = null;
                  state.isSwitching = false;
                  updatePlayButton();
                  updateNowPlaying('—');
                }
              }, 1000);
            } else {
              alert('Ошибка воспроизведения: ' + station.name + '\n' + error.message);
              state.isPlaying = false;
      // Обновить медиа-сессию
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'paused';
        } catch (e) {}
      }
              state.currentStation = null;
              state.isSwitching = false;
              updatePlayButton();
              updateNowPlaying('—');
            }
          }
        });
      }
    }
  };
  
  const handlePlay = () => {
    if (!state.isStopping && state.audio === audioElement) {
      state.isPlaying = true;
      station.incompatible = false;
      state.stationHealth[station.id] = true;
      // Обновить медиа-сессию
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'playing';
        } catch (e) {}
      }
      state.currentStation = station;
      state.isSwitching = false; // Сбросить флаг при успешном запуске
      updateNowPlaying(station.name);
      updatePlayButton();
      
      rememberLastStation(station);
      
      // Добавить станцию в историю
      if (!station.preview) addToHistory(station);
      renderStations(state.stations);
      renderFavorites();
      
      // Если используется crossfade и есть старое аудио - начать fade out старого
      if (useCrossfade && oldAudio && oldAudio !== audioElement) {
        let oldAudioStopped = false;
        const stopOldAudio = () => {
          if (oldAudioStopped) return;
          oldAudioStopped = true;
          // После завершения fade out остановить старое аудио
          try {
            if (oldAudio && oldAudio !== state.audio) {
              oldAudio.pause();
              oldAudio.src = '';
              oldAudio.load();
            }
          } catch (e) {
            // Игнорировать ошибки
          }
        };
        fadeOutVolume(oldAudio, crossfadeDuration, stopOldAudio);
        setTimeout(stopOldAudio, crossfadeDuration + 500);
      }
    }
  };
  
  const handlePause = () => {
    if (!state.isStopping && state.audio === audioElement) {
      state.isPlaying = false;
      // Обновить медиа-сессию
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'paused';
        } catch (e) {}
      }
      updatePlayButton();
    }
  };
  
  const handleEnded = () => {
    if (!state.isStopping && state.audio === audioElement) {
      state.isPlaying = false;
      // Обновить медиа-сессию
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'paused';
        } catch (e) {}
      }
      state.currentStation = null;
      updatePlayButton();
      updateNowPlaying('—');
    }
  };
  
  const handleError = createStreamErrorHandler({ station, streamUrl, audioElement, contentType, retryState });
  
  const handleStalled = () => {
    if (!state.isStopping && state.audio === audioElement) {
      // Поток остановлен (stalled)
      
      // Для MP3 и AAC потоков попробовать перезагрузить при зависании
      if ((contentType === 'audio/mpeg' || contentType === 'audio/aac') && retryState.retryCount < retryState.maxRetries) {
        setTimeout(() => {
          if (!state.isStopping && !state.isPlaying && state.audio === audioElement && audioElement.readyState < 2) {
            retryState.retryCount++;
            // Перезагрузка зависшего потока
            audioElement.load();
          }
        }, 2000);
      }
    }
  };
  
  const handleWaiting = () => {
    if (!state.isStopping && state.audio === audioElement) {
      // Ожидание данных
    }
  };
  
  const handleSuspend = () => {
    if (!state.isStopping && state.audio === audioElement) {
      // Загрузка приостановлена (suspend)
    }
  };
  
  // Обработчик для canplaythrough (поток полностью готов к воспроизведению)
  const handleCanPlayThrough = () => {
    if (!state.isStopping && state.audio === audioElement && !state.isPlaying) {
      // Если поток полностью готов, но еще не играет - попробовать запустить
      if (audioElement.readyState >= 3) { // HAVE_FUTURE_DATA или HAVE_ENOUGH_DATA
        audioElement.play().then(() => {
          // После начала воспроизведения запустить fade in если используется crossfade
          if (useCrossfade && audioElement.volume === 0) {
            fadeInVolume(audioElement, crossfadeDuration);
          }
        }).catch(error => {
          if (!state.isStopping) {
            console.error('CanPlayThrough play error:', error);
          }
        });
      }
    }
  };
  
  // Добавить обработчики
  audioElement.addEventListener('loadstart', handleLoadStart);
  audioElement.addEventListener('canplay', handleCanPlay);
  audioElement.addEventListener('canplaythrough', handleCanPlayThrough); // Отдельный обработчик для полной готовности
  audioElement.addEventListener('playing', handlePlay);
  audioElement.addEventListener('pause', handlePause);
  audioElement.addEventListener('ended', handleEnded);
  audioElement.addEventListener('error', handleError);
  audioElement.addEventListener('stalled', handleStalled);
  audioElement.addEventListener('waiting', handleWaiting);
  audioElement.addEventListener('suspend', handleSuspend);
}

/**
 * Подключает HLS.js к аудио-элементу: останавливает предыдущую сессию,
 * создаёт новую, запускает загрузку и вешает обработчики восстановления после ошибок.
 */
function setupHlsSession({ audioElement, streamUrl, station, useCrossfade, crossfadeDuration }) {
  // Остановить предыдущий HLS если есть
  if (state.hls) {
    try {
      state.hls.stopLoad();
      state.hls.detachMedia();
      state.hls.destroy();
    } catch (e) {
      console.error('Ошибка при остановке предыдущего HLS:', e);
    }
    state.hls = null;
  }
  
  // Создать новый экземпляр HLS
  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 90
  });
  
  state.hls = hls;
  
  // Привязать HLS к audio элементу
  hls.loadSource(streamUrl);
  hls.attachMedia(audioElement);
  
  // Обработчики событий HLS
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    console.log('HLS manifest parsed');
    if (!state.isStopping && state.audio === audioElement) {
      // Начать воспроизведение после парсинга манифеста
      audioElement.play().then(() => {
        if (useCrossfade && audioElement.volume === 0) {
          fadeInVolume(audioElement, crossfadeDuration);
        }
      }).catch(error => {
        console.error('HLS play error:', error);
        alert('Ошибка воспроизведения HLS потока: ' + station.name);
        state.isPlaying = false;
    // Обновить медиа-сессию
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'paused';
      } catch (e) {}
    }
        state.currentStation = null;
        state.isSwitching = false;
      });
    }
  });
  
  hls.on(Hls.Events.ERROR, (event, data) => {
    console.error('HLS error:', data);
    if (data.fatal) {
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          console.error('HLS network error, trying to recover');
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          console.error('HLS media error, trying to recover');
          hls.recoverMediaError();
          break;
        default:
          console.error('HLS fatal error, cannot recover');
          hls.destroy();
          alert('Ошибка загрузки HLS потока: ' + station.name + '\nФормат аудио не поддерживается.\n\nURL: ' + streamUrl);
          state.isPlaying = false;
    // Обновить медиа-сессию
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'paused';
      } catch (e) {}
    }
          state.currentStation = null;
          state.isSwitching = false;
          break;
      }
    }
  });
}

async function playInBrowserPlayer({ station, streamUrl, oldAudio, useCrossfade, crossfadeDuration }) {
  const { contentType, isHLS, hlsSupported, useHLS } = detectStreamFormat(streamUrl);
  
  // Создать новый аудио элемент с правильными настройками
  const audioElement = new Audio();
  // Если используется crossfade, начать с нулевой громкости
  audioElement.volume = useCrossfade ? 0 : state.volume;
  audioElement.preload = 'auto';
  
  // Прямые потоки играем без Web Audio API: часть порталов при CORS-режиме молчит.
  const equalizerEnabled = useHLS && state.settings.equalizer && state.settings.equalizer.enabled && window.Equalizer;
  if (useHLS) {
    audioElement.crossOrigin = 'anonymous';
  }
  
  // Инициализировать HLS если это HLS поток
  if (useHLS) {
    setupHlsSession({ audioElement, streamUrl, station, useCrossfade, crossfadeDuration });
  } else if (isHLS && !hlsSupported) {
    // HLS не поддерживается браузером
    alert('HLS потоки (m3u8) не поддерживаются в этом браузере.\n\nПопробуйте использовать другой поток или обновить браузер.');
    state.isSwitching = false;
    return;
  }
  
  // Инициализировать эквалайзер если он включен
  if (equalizerEnabled) {
    if (!state.equalizer) {
      state.equalizer = new window.Equalizer();
    }
    
    // Отключить старый эквалайзер если есть
    state.equalizer.disconnect();
    
    // Инициализировать с новым аудио элементом
    // Важно: это должно быть сделано ПОСЛЕ установки crossOrigin, но ДО установки src
    // Но init будет вызван после установки src, поэтому crossOrigin уже установлен
  }
  
  // Установить источник напрямую (только если не HLS, для HLS источник устанавливается через hls.loadSource)
  if (!useHLS) {
    // Для потоков без расширения браузер сам определит формат по заголовкам
    // Для MP3 потоков убедимся, что URL правильно обработан
    if (contentType === 'audio/mpeg') {
      // Для MP3 потоков убедимся, что URL не содержит проблемных символов
      // и правильно закодирован
      try {
        const urlObj = new URL(streamUrl);
        // Если URL валидный, используем его как есть
        audioElement.src = streamUrl;
      } catch (e) {
        // Если URL невалидный, попробуем использовать как есть (может быть относительный)
        audioElement.src = streamUrl;
      }
    } else {
      audioElement.src = streamUrl;
    }
  }
  
  // Инициализировать эквалайзер ПОСЛЕ установки src (но crossOrigin уже установлен выше)
  if (equalizerEnabled && state.equalizer) {
    // Инициализировать с новым аудио элементом
    if (state.equalizer.init(audioElement)) {
      // Применить сохраненные настройки
      if (state.settings.equalizer.values) {
        state.equalizer.setValues(state.settings.equalizer.values);
      }
      if (state.settings.equalizer.preset) {
        state.equalizer.setPreset(state.settings.equalizer.preset);
      }
    }
  }
  
  // Общее состояние повторных попыток (нужно обработчику ошибок и handleStalled)
  const retryState = { retryCount: 0, maxRetries: 2, terminalErrorPending: false };
  
  bindAudioElementEvents({ station, streamUrl, audioElement, contentType, useCrossfade, crossfadeDuration, oldAudio, retryState });
  
  // Сохранить ссылку на элемент
  state.audio = audioElement;
  
  // Начать загрузку
  try {
    // Для MP3 потоков добавить небольшую задержку перед загрузкой
    // чтобы дать браузеру время правильно обработать URL
    if (contentType === 'audio/mpeg') {
      setTimeout(() => {
        if (!state.isStopping && state.audio === audioElement) {
          audioElement.load();
        }
      }, 50);
    } else {
      // Для других форматов загрузить сразу
      audioElement.load();
    }
    
    // Сбросить флаг переключения сразу после начала загрузки
    state.isSwitching = false;
  } catch (e) {
    console.error('Ошибка при загрузке аудио:', e);
    alert('Ошибка при загрузке станции: ' + station.name);
    state.audio = null;
    state.currentStation = null;
    state.isSwitching = false;
    state.isStopping = false;
    updateNowPlaying('—');
  }
}

// Переключение воспроизведения/паузы
function togglePlay() {
  if (state.nativeAudio) {
    if (state.isPlaying) {
      window.AppAPI.pauseNative();
      clearLastStation();
    } else {
      window.AppAPI.resumeNative();
      rememberLastStation(state.currentStation);
    }
    state.isPlaying = !state.isPlaying;
    updatePlayButton();
    return;
  }

  if (!state.audio) {
    return;
  }
  
  if (state.isPlaying) {
    state.audio.pause();
  } else {
    state.audio.play().catch(error => {
      console.error('Play error:', error);
    });
  }
}

// Остановка воспроизведения
function stopPlay() {
  // Отключить эквалайзер
  if (state.equalizer) {
    state.equalizer.disconnect();
  }
  
  // Сбросить флаг переключения при остановке
  state.isSwitching = false;

  window.AppAPI.stopNative();
  state.nativeAudio = false;
  if (!state.isClosing) clearLastStation();

  if (state.audio) {
    // Установить флаг программной остановки ПЕРЕД очисткой
    state.isStopping = true;
    
    // Остановить и уничтожить HLS если он используется
    if (state.hls) {
      try {
        state.hls.stopLoad();
        state.hls.detachMedia();
        state.hls.destroy();
      } catch (e) {
        console.error('Ошибка при остановке HLS:', e);
      }
      state.hls = null;
    }
    
    // Остановить воспроизведение
    const audioElement = state.audio;
    
    try {
      // Остановить воспроизведение
      audioElement.pause();
      audioElement.currentTime = 0;
      
      // Очистить источник - это остановит загрузку и предотвратит дальнейшие события
      audioElement.src = '';
      
      // Принудительно перезагрузить для полной очистки
      audioElement.load();
    } catch (e) {
      // Ошибка при остановке аудио (не критично)
    }
    
    // Очистить ссылку сразу после установки флага
    state.audio = null;
    
    // Сбросить флаг через небольшую задержку
    setTimeout(() => {
      state.isStopping = false;
    }, 300);
  }
  
  state.isPlaying = false;
  state.currentStation = null;
  updatePlayButton();
  updateNowPlaying('—');
  renderStations(state.stations);
  renderFavorites();
}

// Остановка всего аудио (при выходе из приложения)
function stopAllAudio() {
  state.isStopping = true;
  stopPlay();
  // Дополнительная очистка
  if (state.audio) {
    const audioElement = state.audio;
    audioElement.pause();
    audioElement.currentTime = 0;
    audioElement.src = '';
    state.audio = null;
  }
  state.isStopping = false;
}

// Обновление кнопки воспроизведения
function updatePlayButton() {
  const btn = document.getElementById('playPauseBtn');
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const miniPlayIcon = document.getElementById('miniPlayIcon');
  const miniPauseIcon = document.getElementById('miniPauseIcon');
  const stopBtn = document.getElementById('stopBtn');
  const miniStopBtn = document.getElementById('miniStopBtn');
  
  if (state.isPlaying) {
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = 'inline-block';
    if (miniPlayIcon) miniPlayIcon.style.display = 'none';
    if (miniPauseIcon) miniPauseIcon.style.display = 'inline-block';
    if (btn) btn.title = 'Пауза';
  } else {
    if (playIcon) playIcon.style.display = 'inline-block';
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (miniPlayIcon) miniPlayIcon.style.display = 'inline-block';
    if (miniPauseIcon) miniPauseIcon.style.display = 'none';
    if (btn) btn.title = 'Воспроизвести';
  }

  const hasAudio = Boolean(state.audio || state.nativeAudio);
  document.querySelectorAll('[data-preview-id]').forEach(button => {
    const active = state.currentStation?.id === button.dataset.previewId && hasAudio;
    button.textContent = active ? '■ Остановить' : '▶ Прослушать';
  });
  if (btn) btn.disabled = !hasAudio;
  if (stopBtn) stopBtn.disabled = !hasAudio;
  if (miniStopBtn) miniStopBtn.disabled = !hasAudio;
}

// Обновление информации о текущей станции
function updateNowPlaying(stationName) {
  // Обновление медиа-сессии для мобильных устройств
  if ('mediaSession' in navigator && state.currentStation) {
    try {
      const station = state.currentStation;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: station.name || stationName || 'Радиостанция',
        artist: station.genre || 'Интернет-радио',
        album: 'CatLu Radio',
        artwork: station.image ? [
          { src: station.image, sizes: '512x512', type: 'image/png' }
        ] : [
          { src: 'assets/icon.png', sizes: '512x512', type: 'image/png' }
        ]
      });
      
      // Обновить состояние воспроизведения
      navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
    } catch (err) {
      console.error('Ошибка обновления медиа-сессии:', err);
    }
  }
  const stationEl = document.getElementById('nowPlayingStation');
  const miniStationEl = document.getElementById('miniPlayerStation');
  
  if (stationEl) {
    stationEl.textContent = stationName || '—';
  }
  if (miniStationEl) {
    miniStationEl.textContent = stationName || '—';
  }
}

// Переключение в мини-плеер
function toggleMiniPlayer() {
  try {
    state.settings.miniPlayer = !state.settings.miniPlayer;
    const container = document.querySelector('.container');
    const miniPlayer = document.getElementById('miniPlayer');
    
    if (!container || !miniPlayer) {
      console.error('Элементы контейнера или мини-плеера не найдены');
      return;
    }
    
    if (state.settings.miniPlayer) {
      // Переключиться в мини-режим
      container.style.display = 'none';
      miniPlayer.style.display = 'flex';
      
      window.AppAPI?.setMiniPlayer?.(true);
      
      // Синхронизировать состояние мини-плеера
      syncMiniPlayer();
    } else {
      // Вернуться в обычный режим
      container.style.display = 'flex';
      miniPlayer.style.display = 'none';
      
      window.AppAPI?.setMiniPlayer?.(false);
    }
    
    // Сохранить настройки
    saveData();
  } catch (error) {
    console.error('Ошибка при переключении мини-плеера:', error);
  }
}

// Синхронизация состояния мини-плеера с основным
function syncMiniPlayer() {
  const miniPlayIcon = document.getElementById('miniPlayIcon');
  const miniPauseIcon = document.getElementById('miniPauseIcon');
  const miniVolumeSlider = document.getElementById('miniVolumeSlider');
  const miniVolumeValue = document.getElementById('miniVolumeValue');
  
  // Обновить иконки play/pause
  if (state.isPlaying) {
    if (miniPlayIcon) miniPlayIcon.style.display = 'none';
    if (miniPauseIcon) miniPauseIcon.style.display = 'inline-block';
  } else {
    if (miniPlayIcon) miniPlayIcon.style.display = 'inline-block';
    if (miniPauseIcon) miniPauseIcon.style.display = 'none';
  }
  
  // Синхронизировать громкость
  if (miniVolumeSlider && miniVolumeValue) {
    miniVolumeSlider.value = state.volume * 100;
    miniVolumeValue.textContent = Math.round(state.volume * 100) + '%';
  }
  
  // Обновить название станции
  updateNowPlaying(state.currentStation ? state.currentStation.name : '—');
}

// Инициализация часов
function initClock() {
  const updateClock = () => {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const timeString = `${hours}:${minutes}:${seconds}`;
    
    const clockTop = document.getElementById('clock');
    const clockBottom = document.getElementById('clockBottom');
    const miniPlayerClock = document.getElementById('miniPlayerClock');
    
    if (clockTop) {
      clockTop.textContent = timeString;
    }
    if (clockBottom) {
      clockBottom.textContent = timeString;
    }
    if (miniPlayerClock) {
      miniPlayerClock.textContent = timeString;
    }
  };
  
  // Обновить сразу
  updateClock();
  
  // Обновлять каждую секунду
  setInterval(updateClock, 1000);
}

// Переключение избранного
function toggleFavorite(stationId) {
  const index = state.favorites.indexOf(stationId);
  
  if (index > -1) {
    state.favorites.splice(index, 1);
  } else {
    state.favorites.push(stationId);
  }
  
  saveData();
  renderStations(state.stations);
  renderFavorites();
}

// Проверка избранного
function isFavorite(stationId) {
  return state.favorites.includes(stationId);
}

// Проверка, является ли станция пользовательской (можно редактировать)
function isUserStation(stationId) {
  // Показывать кнопки редактирования/удаления только если включен режим редактирования
  // Пользовательские станции - это те, что начинаются с 'user-' или 'imported_'
  if (!state.settings.editMode) return false;
  return stationId && (stationId.startsWith('user-') || stationId.startsWith('imported_'));
}

// Используем модуль названий стран
function getCountryName(code) {
  if (window.CountryNames) {
    return window.CountryNames.getName(code);
  }
  return code;
}

async function checkAllStations() {
  const button = document.getElementById('checkStationsBtn');
  const status = document.getElementById('stationCheckStatus');
  if (button.dataset.busy === 'true') return;
  button.dataset.busy = 'true';
  button.setAttribute('aria-disabled', 'true');
  status.textContent = 'Проверка…';
  let working = 0;
  await Promise.all(state.stations.map(async station => {
    const result = await window.AppAPI.checkStream(station.url);
    if (result?.success === true) {
      state.stationHealth[station.id] = true;
      station.incompatible = false;
      working++;
    } else {
      delete state.stationHealth[station.id];
    }
  }));
  await window.AppAPI.saveStations(state.stations);
  renderStations(state.stations);
  status.textContent = `Работают ${working} из ${state.stations.length}`;
  button.dataset.busy = 'false';
  button.removeAttribute('aria-disabled');
}

let availableUpdate = null;
async function checkForUpdates() {
  const status = document.getElementById('updateStatus');
  const install = document.getElementById('installUpdateBtn');
  if (!status || !install) return;
  status.textContent = 'Проверка обновлений…';
  install.style.display = 'none';
  const result = await window.AppAPI.checkForUpdate();
  if (!result?.success) {
    status.textContent = 'Не удалось проверить обновления.';
    return;
  }
  if (!result.hasUpdate || !result.url) {
    status.textContent = 'Установлена последняя версия.';
    return;
  }
  availableUpdate = result;
  status.textContent = `Доступна версия ${result.version}.`;
  install.textContent = `Обновить до ${result.version}`;
  install.style.display = 'inline-block';
}

async function installAvailableUpdate() {
  if (!availableUpdate?.url || !confirm(`Скачать и установить версию ${availableUpdate.version}?`)) return;
  document.getElementById('updateStatus').textContent = 'Скачивание установщика…';
  const result = await window.AppAPI.installUpdate(availableUpdate.url);
  if (!result?.success) document.getElementById('updateStatus').textContent = 'Не удалось запустить обновление.';
}

async function searchOnlineStations() {
  const query = document.getElementById('onlineSearchInput').value.trim();
  const country = document.getElementById('onlineCountrySelect').value;
  const portal = document.getElementById('onlinePortalSelect').value;
  const results = document.getElementById('onlineResults');
  if (!query && country === 'all' && portal === 'all') {
    results.hidden = false;
    results.textContent = 'Введите название, стиль, исполнителя, годы или выберите страну.';
    return;
  }

  results.hidden = false;
  results.textContent = 'Поиск…';
  let stations = await window.AppAPI.searchOnlineStations(query, country === 'all' ? '' : country, portal);
  stations = stations.filter(s => s.lastcheckok === 1);
  const uniqueStations = new Map();
  stations.forEach(station => {
    const key = `${station.countrycode || ''}:${onlineStationKey(station.name)}`;
    const primary = uniqueStations.get(key);
    if (primary) primary.backupSources.push(station);
    else uniqueStations.set(key, { ...station, backupSources: [] });
  });
  stations = [...uniqueStations.values()];
  results.replaceChildren();
  if (!stations.length) {
    results.textContent = 'Работающие станции не найдены.';
    return;
  }

  stations.forEach(found => {
    const row = document.createElement('div');
    row.className = 'online-result';
    const info = document.createElement('span');
    info.textContent = `${found.name} — ${found.source || 'Radio Browser'}`;
    const actions = document.createElement('div');
    actions.className = 'online-result-actions';
    const previewStation = {
      id: `preview-online-${found.stationuuid || found.name}`,
      name: found.name,
      url: found.url_resolved || found.url || '',
      country: found.countrycode || 'OTHER',
      genre: (found.tags || 'Other').split(',')[0],
      image: found.favicon || '',
      preview: true
    };
    const preview = document.createElement('button');
    preview.className = 'btn btn-secondary online-preview';
    preview.dataset.previewId = previewStation.id;
    preview.textContent = '▶ Прослушать';
    preview.addEventListener('click', async () => {
      if (state.currentStation?.id === previewStation.id && (state.audio || state.nativeAudio)) return stopPlay();
      previewStation.url = await window.AppAPI.resolvePortalStation(found);
      if (previewStation.url) playStation(previewStation);
    });
    const add = document.createElement('button');
    add.className = 'btn btn-primary';
    add.textContent = 'Добавить';
    add.addEventListener('click', async () => {
      const urls = await Promise.all([found, ...found.backupSources].map(window.AppAPI.resolvePortalStation));
      const [url, ...backupUrls] = [...new Set(urls.filter(Boolean))];
      if (!url || state.stations.some(s => s.url === url)) return;
      const station = { id: `user-online-${found.stationuuid || Date.now()}`, name: found.name, url, primaryUrl: url, backupUrls, country: found.countrycode || 'OTHER', genre: (found.tags || 'Other').split(',')[0], image: found.favicon || '', source: found.source || 'Radio Browser' };
      state.stations.push(station);
      state.stationHealth[station.id] = true;
      await saveData();
      document.getElementById('filterSelect').value = 'all';
      loadStations();
      results.hidden = true;
      results.replaceChildren();
      add.textContent = 'Добавлено';
      add.disabled = true;
      switchTab('stations');
    });
    actions.append(preview, add);
    row.append(info, actions);
    results.append(row);
  });
}

function clearOnlineSearch() {
  document.getElementById('onlinePortalSelect').value = 'all';
  document.getElementById('onlineSearchInput').value = '';
  document.getElementById('onlineCountrySelect').value = 'all';
  const results = document.getElementById('onlineResults');
  results.hidden = true;
  results.replaceChildren();
}

function normalizedStationName(name) {
  return (name || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function onlineStationKey(name) {
  return normalizedStationName(name).replace(/^(101 ru|radio browser|radiopotok|dfm|maximum|rlive|radijo stotys)\s+/, '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

async function tryRecoverStation(station, failedUrl) {
  if (state.isRecoveringStream) return false;
  state.isRecoveringStream = true;
  try {
    const expected = normalizedStationName(station.name);
    const candidates = (await window.AppAPI.searchOnlineStations(station.name))
      .filter(s => normalizedStationName(s.name) === expected)
      .filter(s => !station.country || station.country === 'OTHER' || s.countrycode === station.country)
      .map(s => s.url_resolved || s.url)
      .filter(url => url && url !== failedUrl);

    for (const url of [...new Set(candidates)].slice(0, 5)) {
      if ((await window.AppAPI.checkStream(url))?.success) {
        station.primaryUrl ||= failedUrl;
        station.backupUrls = [...new Set([...(station.backupUrls || []), url])];
        station.url = url;
        station.incompatible = false;
        state.stationHealth[station.id] = true;
        await saveData();
        state.isRecoveringStream = false;
        playStation(station);
        return true;
      }
    }
    return false;
  } finally {
    state.isRecoveringStream = false;
  }
}

// Настройка обработчиков событий
function setupEventListeners() {
  // Вкладки
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
  
  // Кнопки управления
  document.getElementById('playPauseBtn').addEventListener('click', togglePlay);
  document.getElementById('stopBtn').addEventListener('click', stopPlay);
  document.getElementById('checkStationsBtn')?.addEventListener('click', event => {
    event.preventDefault();
    checkAllStations();
  });
  document.getElementById('checkUpdateBtn')?.addEventListener('click', checkForUpdates);
  document.getElementById('installUpdateBtn')?.addEventListener('click', installAvailableUpdate);
  document.getElementById('onlineSearchBtn')?.addEventListener('click', searchOnlineStations);
  document.getElementById('clearOnlineSearchBtn')?.addEventListener('click', clearOnlineSearch);
  document.getElementById('backToStationsBtn')?.addEventListener('click', () => switchTab('stations'));
  document.getElementById('onlineSearchInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') searchOnlineStations();
  });
  
  // Кнопка мини-плеера
  const minimizePlayerBtn = document.getElementById('minimizePlayerBtn');
  if (minimizePlayerBtn) {
    minimizePlayerBtn.addEventListener('click', toggleMiniPlayer);
  }
  
  // Громкость
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  
  volumeSlider.addEventListener('input', (e) => {
    const volume = e.target.value / 100;
    state.volume = volume;
    volumeValue.textContent = Math.round(volume * 100) + '%';
    
    // Синхронизировать с мини-плеером
    const miniVolumeSlider = document.getElementById('miniVolumeSlider');
    const miniVolumeValue = document.getElementById('miniVolumeValue');
    if (miniVolumeSlider) miniVolumeSlider.value = volume * 100;
    if (miniVolumeValue) miniVolumeValue.textContent = Math.round(volume * 100) + '%';
    
    if (state.audio) {
      state.audio.volume = volume;
    }
    if (state.nativeAudio) window.AppAPI.setNativeVolume(volume);
    
    saveData();
  });
  
  // Мини-плеер: кнопки управления
  const miniPlayPauseBtn = document.getElementById('miniPlayPauseBtn');
  const miniStopBtn = document.getElementById('miniStopBtn');
  const expandPlayerBtn = document.getElementById('expandPlayerBtn');
  const miniExitBtn = document.getElementById('miniExitBtn');
  const miniVolumeSlider = document.getElementById('miniVolumeSlider');
  const miniVolumeValue = document.getElementById('miniVolumeValue');
  
  if (miniPlayPauseBtn) {
    miniPlayPauseBtn.addEventListener('click', togglePlay);
  }
  if (miniStopBtn) {
    miniStopBtn.addEventListener('click', stopPlay);
  }
  if (expandPlayerBtn) {
    expandPlayerBtn.addEventListener('click', toggleMiniPlayer);
  }
  if (miniExitBtn) {
    miniExitBtn.addEventListener('click', () => {
      window.AppAPI.exitApp();
    });
  }
  if (miniVolumeSlider) {
    miniVolumeSlider.addEventListener('input', (e) => {
      const volume = e.target.value / 100;
      state.volume = volume;
      if (miniVolumeValue) miniVolumeValue.textContent = Math.round(volume * 100) + '%';
      
      // Синхронизировать с основным плеером
      if (volumeSlider) volumeSlider.value = volume * 100;
      if (volumeValue) volumeValue.textContent = Math.round(volume * 100) + '%';
      
      if (state.audio) {
        state.audio.volume = volume;
      }
      if (state.nativeAudio) window.AppAPI.setNativeVolume(volume);
      
      saveData();
    });
  }
  
  // Поиск
  document.getElementById('searchInput').addEventListener('input', () => {
    loadStations();
  });
  
  // Фильтр
  document.getElementById('filterSelect').addEventListener('change', () => {
    loadStations();
  });
  
  // Сортировка
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    state.settings.sortType = e.target.value;
    saveData();
    loadStations();
  });
  
  // Добавление станции
  document.getElementById('addStationBtn').addEventListener('click', async () => {
    await addStation();
  });
  
  // Обновление станции (кнопка "Сохранить изменения")
  document.getElementById('updateStationBtn').addEventListener('click', async () => {
    const editingId = document.getElementById('editingStationId').value;
    if (editingId) {
      await updateStation(editingId);
    } else {
      alert('Ошибка: не выбрана станция для редактирования');
    }
  });
  
  // Отмена редактирования
  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    resetStationForm();
    const messageEl = document.getElementById('addStationMessage');
    messageEl.textContent = '';
    messageEl.className = 'message';
  });
  
  // Изменение режима редактирования
  document.getElementById('editMode').addEventListener('change', (e) => {
    // Обновить состояние сразу
    state.settings.editMode = e.target.checked;
    // Сохранить настройки
    saveData();
    // Обновить список станций чтобы показать/скрыть кнопки редактирования
    loadStations();
    renderFavorites();
  });
  
  // Сохранение настроек
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  
  // Изменение языка
  document.getElementById('languageSelect').addEventListener('change', (e) => {
    state.settings.language = e.target.value;
    if (window.TranslationManager) {
      window.TranslationManager.setLanguage(e.target.value);
      window.TranslationManager.applyTranslations();
    } else {
      applyTranslations();
    }
    saveData();
  });
  
  // Изменение темы
  document.getElementById('themeSelect').addEventListener('change', (e) => {
    const theme = e.target.value;
    state.settings.theme = theme;
    if (window.ThemeManager) {
      window.ThemeManager.applyTheme(theme);
    } else {
      applyTheme(theme);
    }
    saveData();
  });
  
  // Импорт/экспорт
  document.getElementById('exportBtn').addEventListener('click', exportStations);
  document.getElementById('importBtn').addEventListener('click', importStations);
  
  // История
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      if (confirm('Вы уверены, что хотите очистить историю прослушанных станций?')) {
        clearHistory();
      }
    });
  }
  
  // Таймер сна
  const sleepTimerEnabled = document.getElementById('sleepTimerEnabled');
  const sleepTimerControls = document.getElementById('sleepTimerControls');
  const startSleepTimerBtn = document.getElementById('startSleepTimerBtn');
  const stopSleepTimerBtn = document.getElementById('stopSleepTimerBtn');
  const sleepTimerDuration = document.getElementById('sleepTimerDuration');
  const sleepTimerStatus = document.getElementById('sleepTimerStatus');
  
  if (sleepTimerEnabled) {
    if (!state.settings.sleepTimer) {
      state.settings.sleepTimer = { enabled: false, duration: 60 };
    }
    sleepTimerEnabled.checked = state.settings.sleepTimer.enabled || false;
    if (sleepTimerControls) {
      sleepTimerControls.style.display = sleepTimerEnabled.checked ? 'block' : 'none';
    }
    
    sleepTimerEnabled.addEventListener('change', (e) => {
      state.settings.sleepTimer.enabled = e.target.checked;
      if (sleepTimerControls) {
        sleepTimerControls.style.display = e.target.checked ? 'block' : 'none';
      }
      if (!e.target.checked) {
        stopSleepTimer();
      }
      saveData();
    });
  }
  
  if (sleepTimerDuration && state.settings.sleepTimer) {
    sleepTimerDuration.value = state.settings.sleepTimer.duration || 60;
  }
  
  if (startSleepTimerBtn) {
    startSleepTimerBtn.addEventListener('click', () => {
      const duration = parseInt(sleepTimerDuration?.value || 60);
      if (duration > 0) {
        startSleepTimer(duration);
      }
    });
  }
  
  if (stopSleepTimerBtn) {
    stopSleepTimerBtn.addEventListener('click', stopSleepTimer);
  }
  
  // Планировщик
  const schedulerEnabled = document.getElementById('schedulerEnabled');
  const schedulerControls = document.getElementById('schedulerControls');
  const addScheduleBtn = document.getElementById('addScheduleBtn');
  
  if (schedulerEnabled) {
    if (!state.settings.scheduler) {
      state.settings.scheduler = { enabled: false, schedules: [] };
    }
    schedulerEnabled.checked = state.settings.scheduler.enabled || false;
    if (schedulerControls) {
      schedulerControls.style.display = schedulerEnabled.checked ? 'block' : 'none';
    }
    
    schedulerEnabled.addEventListener('change', (e) => {
      state.settings.scheduler.enabled = e.target.checked;
      if (schedulerControls) {
        schedulerControls.style.display = e.target.checked ? 'block' : 'none';
      }
      if (e.target.checked) {
        initScheduler();
        renderSchedules();
      } else {
        stopScheduler();
      }
      saveData();
    });
  }
  
  if (addScheduleBtn) {
    addScheduleBtn.addEventListener('click', () => {
      addSchedule();
    });
  }
  
  // Кнопка сохранения расписания в модальном окне
  const saveScheduleBtn = document.getElementById('saveScheduleBtn');
  if (saveScheduleBtn) {
    saveScheduleBtn.addEventListener('click', saveSchedule);
  }
  
  // Закрытие модального окна при клике вне его
  const scheduleModal = document.getElementById('scheduleModal');
  if (scheduleModal) {
    scheduleModal.addEventListener('click', (e) => {
      if (e.target === scheduleModal) {
        closeScheduleModal();
      }
    });
  }
  
  // Инициализировать планировщик если включен
  if (state.settings.scheduler?.enabled) {
    initScheduler();
    renderSchedules();
  }
  
  // Извлечение потока из TuneIn
  document.getElementById('extractTuneInBtn').addEventListener('click', extractTuneInStream);
  
  // Кнопка извлечения потока из RadioPotok
  const extractRadioPotokBtn = document.getElementById('extractRadioPotokBtn');
  if (extractRadioPotokBtn) {
    extractRadioPotokBtn.addEventListener('click', extractRadioPotokStream);
  }
  
  // Кнопка выхода из приложения (в заголовке)
  const exitBtn = document.getElementById('exitBtn');
  if (exitBtn) {
    exitBtn.addEventListener('click', async () => {
      if (window.AppAPI && window.AppAPI.exitApp) {
        await window.AppAPI.exitApp();
      } else {
        // Fallback для веб-версии
        if (confirm('Вы уверены, что хотите закрыть приложение?')) {
          window.close();
        }
      }
    });
  }
  
  // Кнопка выхода из приложения (в настройках)
  const exitAppBtn = document.getElementById('exitAppBtn');
  if (exitAppBtn) {
    exitAppBtn.addEventListener('click', async () => {
      if (window.AppAPI && window.AppAPI.exitApp) {
        await window.AppAPI.exitApp();
      } else {
        // Fallback для веб-версии
        if (confirm('Вы уверены, что хотите закрыть приложение?')) {
          window.close();
        }
      }
    });
  }
  
  // Эквалайзер
  initEqualizer();
}

// Показать отладочную информацию в интерфейсе
function showEqualizerDebug(message, isError = false) {
  const debugEl = document.getElementById('equalizerDebug');
  if (debugEl) {
    debugEl.textContent = message;
    debugEl.style.display = 'block';
    debugEl.style.background = isError ? 'rgba(255, 0, 0, 0.1)' : 'rgba(0, 255, 0, 0.1)';
    debugEl.style.borderColor = isError ? 'rgba(255, 0, 0, 0.3)' : 'rgba(0, 255, 0, 0.3)';
    debugEl.style.color = isError ? 'red' : 'green';
  }
}

// Инициализация эквалайзера
function initEqualizer() {
  // Проверить что модуль загружен
  if (!window.Equalizer) {
    showEqualizerDebug('ОШИБКА: Модуль Equalizer не загружен. Проверьте загрузку modules/Equalizer.js', true);
    // Попробовать еще раз через небольшую задержку
    setTimeout(() => {
      if (window.Equalizer) {
        initEqualizer();
      } else {
        showEqualizerDebug('ОШИБКА: Модуль Equalizer не найден после повторной попытки', true);
      }
    }, 500);
    return;
  }

  // Создать экземпляр эквалайзера если еще не создан
  if (!state.equalizer) {
    state.equalizer = new window.Equalizer();
  }

  // Инициализировать UI эквалайзера
  const bandsContainer = document.getElementById('equalizerBands');
  if (!bandsContainer) {
    showEqualizerDebug('ОШИБКА: Элемент equalizerBands не найден в DOM', true);
    // Попробовать еще раз через небольшую задержку
    setTimeout(() => {
      const container = document.getElementById('equalizerBands');
      if (container) {
        initEqualizer();
      } else {
        showEqualizerDebug('ОШИБКА: Элемент equalizerBands не найден после повторной попытки', true);
      }
    }, 500);
    return;
  }

  // Очистить контейнер
  bandsContainer.innerHTML = '';

  // Получить частоты полос
  const frequencies = window.Equalizer.getFrequencies();
  
  if (!frequencies || frequencies.length === 0) {
    showEqualizerDebug('ОШИБКА: Не удалось получить частоты эквалайзера', true);
    return;
  }

  // Частоты получены успешно

  // Создать слайдеры для каждой полосы
  frequencies.forEach((freq, index) => {
    const bandDiv = document.createElement('div');
    bandDiv.className = 'equalizer-band';
    
    const label = document.createElement('label');
    label.textContent = freq < 1000 ? `${freq}Hz` : `${freq / 1000}kHz`;
    label.setAttribute('for', `eqBand${index}`);
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `eqBand${index}`;
    slider.className = 'eq-slider';
    slider.min = '-12';
    slider.max = '12';
    slider.value = state.settings.equalizer?.values?.[index] || 0;
    slider.step = '0.5';
    slider.setAttribute('data-band', index);
    slider.setAttribute('orient', 'vertical'); // Для Firefox
    slider.style.cssText = 'width: 100%; min-width: 30px; height: 200px; writing-mode: vertical-lr; direction: rtl; cursor: pointer; accent-color: var(--md-primary); display: block; visibility: visible; opacity: 1;';
    
    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'eq-value';
    valueDisplay.textContent = slider.value === '0' ? '0' : (slider.value > 0 ? '+' + slider.value : slider.value);
    
    slider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      valueDisplay.textContent = value === 0 ? '0' : (value > 0 ? '+' + value.toFixed(1) : value.toFixed(1));
      
      if (state.equalizer) {
        state.equalizer.setBandValue(index, value);
        
        // Сохранить настройки
        if (!state.settings.equalizer) {
          state.settings.equalizer = { enabled: true, values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preset: 'normal' };
        }
        state.settings.equalizer.values[index] = value;
        state.settings.equalizer.preset = 'custom';
        
        // Применить к текущему аудио если играет
        if (state.audio && state.equalizer.isEnabled) {
          state.equalizer.setBandValue(index, value);
        }
        if (state.nativeAudio) window.AppAPI.setNativeEqualizer(state.settings.equalizer.values);
        
        saveData();
      }
    });
    
    bandDiv.appendChild(label);
    bandDiv.appendChild(slider);
    bandDiv.appendChild(valueDisplay);
    bandsContainer.appendChild(bandDiv);
  });
  
  // Проверить что элементы действительно созданы
  const createdSliders = bandsContainer.querySelectorAll('.eq-slider');
  
  if (createdSliders.length === 0) {
    showEqualizerDebug('ОШИБКА: Слайдеры не были созданы! Проверьте код создания элементов.', true);
    bandsContainer.innerHTML = '<p style="color: red; padding: 16px; text-align: center;">Ошибка создания эквалайзера. Слайдеры не были созданы.</p>';
    return;
  }
  
  if (createdSliders.length !== frequencies.length) {
    showEqualizerDebug(`ВНИМАНИЕ: Создано ${createdSliders.length} слайдеров из ${frequencies.length}`, false);
  } else {
    showEqualizerDebug(`Успешно создано ${createdSliders.length} полос эквалайзера ✓`, false);
  }
  
  // Скрыть отладочную информацию если все успешно
  if (createdSliders.length === frequencies.length) {
    const debugEl = document.getElementById('equalizerDebug');
    if (debugEl) {
      debugEl.style.display = 'none';
    }
  }

  // Предустановки
  const presetSelect = document.getElementById('eqPresetSelect');
  if (presetSelect) {
    presetSelect.value = state.settings.equalizer?.preset || 'normal';
    
    presetSelect.addEventListener('change', (e) => {
      const preset = e.target.value;
      
      if (state.equalizer) {
        state.equalizer.setPreset(preset);
        
        // Обновить слайдеры
        const values = state.equalizer.getValues();
        values.forEach((value, index) => {
          const slider = document.getElementById(`eqBand${index}`);
          const valueDisplay = slider?.nextElementSibling;
          if (slider) {
            slider.value = value;
            if (valueDisplay) {
              valueDisplay.textContent = value === 0 ? '0' : (value > 0 ? '+' + value.toFixed(1) : value.toFixed(1));
            }
          }
        });
        
        // Сохранить настройки
        if (!state.settings.equalizer) {
          state.settings.equalizer = { enabled: true, values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preset: 'normal' };
        }
        state.settings.equalizer.values = [...values];
        state.settings.equalizer.preset = preset;
        
        // Применить к текущему аудио если играет
        if (state.audio && state.equalizer.isEnabled) {
          state.equalizer.setValues(values);
        }
        if (state.nativeAudio) window.AppAPI.setNativeEqualizer(values);
        
        saveData();
      }
    });
  }

  // Кнопка сброса
  const resetBtn = document.getElementById('eqResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (state.equalizer) {
        state.equalizer.reset();
        
        // Обновить слайдеры
        frequencies.forEach((freq, index) => {
          const slider = document.getElementById(`eqBand${index}`);
          const valueDisplay = slider?.nextElementSibling;
          if (slider) {
            slider.value = 0;
            if (valueDisplay) {
              valueDisplay.textContent = '0';
            }
          }
        });
        
        // Обновить предустановку
        if (presetSelect) {
          presetSelect.value = 'normal';
        }
        
        // Сохранить настройки
        if (!state.settings.equalizer) {
          state.settings.equalizer = { enabled: true, values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preset: 'normal' };
        }
        state.settings.equalizer.values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        state.settings.equalizer.preset = 'normal';
        
        // Применить к текущему аудио если играет
        if (state.audio && state.equalizer.isEnabled) {
          state.equalizer.setValues([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        }
        if (state.nativeAudio) window.AppAPI.setNativeEqualizer(state.settings.equalizer.values);
        
        saveData();
      }
    });
  }
}

// Переключение вкладок
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`${tabName}-tab`).classList.add('active');
  
  if (tabName === 'favorites') {
    renderFavorites();
  } else if (tabName === 'history') {
    renderHistory();
  }
}

// Добавление станции
async function addStation() {
  const editingId = document.getElementById('editingStationId').value;
  
  if (editingId) {
    await updateStation(editingId);
    return;
  }
  
  const name = document.getElementById('stationName').value.trim();
  const url = document.getElementById('stationUrl').value.trim();
  const country = document.getElementById('stationCountry').value;
  const genre = document.getElementById('stationGenre').value;
  const messageEl = document.getElementById('addStationMessage');
  
  if (!name || !url) {
    messageEl.textContent = t('stationError');
    messageEl.className = 'message error';
    return;
  }
  
  // Проверить валидность URL
  try {
    new URL(url);
  } catch (e) {
    messageEl.textContent = 'Ошибка: неверный URL';
    messageEl.className = 'message error';
    return;
  }
  
  const newStation = {
    id: 'user-' + Date.now(),
    name,
    url,
    country,
    genre
  };
  
  state.stations.push(newStation);
  
  try {
    await saveData();
    messageEl.textContent = t('stationAdded');
    messageEl.className = 'message success';
    
    // Очистить форму
    resetStationForm();
    
    // Обновить список
    await loadData();
    loadStations();
    
    setTimeout(() => {
      messageEl.textContent = '';
      messageEl.className = 'message';
    }, 3000);
  } catch (error) {
    console.error('Ошибка сохранения:', error);
    messageEl.textContent = 'Ошибка при сохранении станции: ' + error.message;
    messageEl.className = 'message error';
  }
}

// Редактирование станции
function editStation(stationId) {
  const station = state.stations.find(s => s.id === stationId);
  
  if (!station) {
    alert('Станция не найдена');
    return;
  }
  
  // Заполнить форму данными станции
  document.getElementById('stationName').value = station.name || '';
  document.getElementById('stationUrl').value = station.url || '';
  document.getElementById('stationCountry').value = station.country || 'OTHER';
  document.getElementById('stationGenre').value = station.genre || 'Other';
  document.getElementById('editingStationId').value = stationId;
  
  // Показать кнопки редактирования
  document.getElementById('addStationBtn').style.display = 'none';
  document.getElementById('updateStationBtn').style.display = 'inline-block';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  // Заголовок формы теперь в настройках, не нужно обновлять
  
  // Очистить сообщение
  const messageEl = document.getElementById('addStationMessage');
  messageEl.textContent = '';
  messageEl.className = 'message';
  
  // Переключиться на вкладку настроек
  switchTab('settings');
  
  // Раскрыть аккордеон "Управление станциями" и прокрутить к форме
  setTimeout(() => {
    const accordionContent = document.getElementById('stations-management');
    if (accordionContent) {
      // Проверить, раскрыт ли аккордеон (проверяем класс active)
      const isExpanded = accordionContent.classList.contains('active');
      if (!isExpanded) {
        // Раскрыть аккордеон через глобальную функцию toggleAccordion
        if (typeof window.toggleAccordion === 'function') {
          window.toggleAccordion('stations-management');
        } else {
          // Если функция не доступна глобально, используем прямую логику
          accordionContent.classList.add('active');
          const header = accordionContent.previousElementSibling;
          if (header) {
            header.classList.add('active');
          }
        }
      }
      
      // Прокрутить к форме
      setTimeout(() => {
        const form = document.getElementById('addStationForm');
        if (form) {
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Также можно прокрутить к первому полю формы
          const firstInput = form.querySelector('input');
          if (firstInput) {
            firstInput.focus();
          }
        }
      }, 200);
    }
  }, 100);
}

// Обновление станции
async function updateStation(stationId) {
  const name = document.getElementById('stationName').value.trim();
  const url = document.getElementById('stationUrl').value.trim();
  const country = document.getElementById('stationCountry').value;
  const genre = document.getElementById('stationGenre').value;
  const messageEl = document.getElementById('addStationMessage');
  
  if (!name || !url) {
    messageEl.textContent = t('stationError');
    messageEl.className = 'message error';
    return;
  }
  
  // Проверить валидность URL
  try {
    new URL(url);
  } catch (e) {
    messageEl.textContent = 'Ошибка: неверный URL';
    messageEl.className = 'message error';
    return;
  }
  
  // Найти и обновить станцию
  const stationIndex = state.stations.findIndex(s => s.id === stationId);
  
  if (stationIndex !== -1) {
    // Обновить станцию
    state.stations[stationIndex] = {
      ...state.stations[stationIndex],
      name,
      url,
      country,
      genre
    };
  } else {
    // Если станция не найдена, создать новую
    state.stations.push({
      id: 'user-' + Date.now(),
      name,
      url,
      country,
      genre
    });
  }
  
  // Сохранить изменения
  try {
    await saveData();
    // Станции сохранены
    
    messageEl.textContent = 'Станция успешно обновлена и сохранена!';
    messageEl.className = 'message success';
    
    // Очистить форму
    resetStationForm();
    
    // Обновить список станций
    await loadData();
    loadStations();
    
    setTimeout(() => {
      messageEl.textContent = '';
      messageEl.className = 'message';
    }, 3000);
  } catch (error) {
    console.error('Ошибка сохранения:', error);
    messageEl.textContent = 'Ошибка при сохранении станции: ' + error.message;
    messageEl.className = 'message error';
  }
}

// Удаление станции
async function deleteStation(stationId) {
  // Подтверждение удаления
  if (!confirm('Вы уверены, что хотите удалить эту станцию?')) {
    return;
  }
  
  // Найти и удалить станцию из массива
  const stationIndex = state.stations.findIndex(s => s.id === stationId);
  
  if (stationIndex === -1) {
    alert('Станция не найдена');
    return;
  }
  
  // Удалить станцию из массива
  state.stations.splice(stationIndex, 1);
  
  // Удалить из избранного, если там есть
  const favoriteIndex = state.favorites.indexOf(stationId);
  if (favoriteIndex !== -1) {
    state.favorites.splice(favoriteIndex, 1);
  }
  
  // Если удаляемая станция сейчас играет - остановить воспроизведение
  if (state.currentStation && state.currentStation.id === stationId) {
    stopPlay();
  }
  
  // Сохранить изменения
  try {
    await saveData();
    // Станция удалена
    
    // Обновить список станций
    loadStations();
  } catch (error) {
    console.error('Ошибка при удалении станции:', error);
    alert('Ошибка при удалении станции: ' + error.message);
  }
}

// Сброс формы станции
function resetStationForm() {
  document.getElementById('stationName').value = '';
  document.getElementById('stationUrl').value = '';
  document.getElementById('stationCountry').value = 'RU';
  document.getElementById('stationGenre').value = 'Pop';
  document.getElementById('editingStationId').value = '';
  
  // Скрыть кнопки редактирования и показать кнопку добавления
  document.getElementById('addStationBtn').style.display = 'inline-block';
  document.getElementById('updateStationBtn').style.display = 'none';
  document.getElementById('cancelEditBtn').style.display = 'none';
  // Заголовок формы теперь в настройках, не нужно обновлять
  
  // Очистить сообщение
  const messageEl = document.getElementById('addStationMessage');
  messageEl.textContent = '';
  messageEl.className = 'message';
}

// Применение темы (fallback если модуль не загружен)
function applyTheme(theme) {
  if (window.ThemeManager) {
    window.ThemeManager.applyTheme(theme);
    return;
  }
  
  // Fallback логика
  let actualTheme = theme;
  
  if (theme === 'system') {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    actualTheme = prefersDark ? 'dark' : 'light';
    
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (state.settings.theme === 'system') {
          applyTheme('system');
        }
      });
    }
  }
  
  document.documentElement.setAttribute('data-theme', actualTheme);
}

// Сохранение настроек
function saveSettings() {
  state.settings.minimizeToTray = document.getElementById('minimizeToTray').checked;
  state.settings.startMinimized = document.getElementById('startMinimized').checked;
  state.settings.editMode = document.getElementById('editMode').checked;
  state.settings.theme = document.getElementById('themeSelect').value;
  
  if (window.ThemeManager) {
    window.ThemeManager.applyTheme(state.settings.theme);
  } else {
    applyTheme(state.settings.theme);
  }
  saveData();
  
  // Обновить список станций чтобы показать/скрыть кнопки редактирования
  loadStations();
  
  const messageEl = document.getElementById('settingsMessage');
  messageEl.textContent = t('settingsSaved');
  messageEl.className = 'message success';
  
  setTimeout(() => {
    messageEl.textContent = '';
    messageEl.className = 'message';
  }, 3000);
}

// Применить переводы (fallback если модуль не загружен)
function applyTranslations() {
  if (window.TranslationManager) {
    window.TranslationManager.applyTranslations();
    return;
  }
  
  // Fallback логика
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
  
    // Заголовок формы теперь в настройках, не нужно обновлять
}

// Настройка IPC слушателей
function setupIPCListeners() {
  window.AppAPI.onTogglePlay(() => {
    togglePlay();
  });
  
  window.AppAPI.onStopPlay(() => {
    stopPlay();
  });
  
  window.AppAPI.onStopAllAudio(() => {
    stopAllAudio();
  });
  
  window.AppAPI.onShowAbout(() => {
    alert('CatLu Radio v3.1.7\n\nПриложение для прослушивания интернет-радио.');
  });
  
  // Очистка при закрытии окна
  window.addEventListener('beforeunload', () => {
    state.isClosing = true;
    stopAllAudio();
  });
}

// Экспорт станций
async function exportStations() {
  try {
    // Получаем все станции
    const result = await window.AppAPI.exportStations(state.stations);
    
    if (result.success) {
      alert(`Станции успешно экспортированы в файл:\n${result.path}`);
    } else if (!result.canceled) {
      alert(`Ошибка экспорта: ${result.error || 'Неизвестная ошибка'}`);
    }
  } catch (error) {
    console.error('Export error:', error);
    alert('Ошибка при экспорте станций');
  }
}

// Импорт станций
async function importStations() {
  try {
    const result = await window.AppAPI.importStations();
    
    if (result.success) {
      let message = `Импортировано станций: ${result.imported}\nВсего станций: ${result.total}`;
      if (result.skipped && result.skipped > 0) {
        message += `\nПропущено дубликатов: ${result.skipped}`;
      }
      alert(message);
      // Перезагрузить данные и обновить список
      await loadData();
      loadStations();
    } else if (!result.canceled) {
      alert(`Ошибка импорта: ${result.error || 'Неизвестная ошибка'}`);
    }
  } catch (error) {
    console.error('Import error:', error);
    alert('Ошибка при импорте станций. Проверьте формат файла.');
  }
}

// Извлечение потока из TuneIn
async function extractTuneInStream() {
  const urlInput = document.getElementById('stationUrl');
  const messageEl = document.getElementById('addStationMessage');
  const tuneInUrl = urlInput.value.trim();
  
  if (!tuneInUrl) {
    messageEl.textContent = 'Введите URL TuneIn или iframe код';
    messageEl.className = 'message error';
    return;
  }
  
  messageEl.textContent = 'Извлечение потока из TuneIn...';
  messageEl.className = 'message';
  
  try {
    // Использовать IPC для извлечения потока (обход CORS)
    const result = await window.AppAPI.extractTuneInStream(tuneInUrl);
    
    if (result.success && result.streamUrl) {
      // Заполнить поля формы
      urlInput.value = result.streamUrl;
      if (result.stationName && !document.getElementById('stationName').value) {
        document.getElementById('stationName').value = result.stationName;
      }
      
      messageEl.textContent = 'Поток успешно извлечен из TuneIn!';
      messageEl.className = 'message success';
      
      setTimeout(() => {
        messageEl.textContent = '';
        messageEl.className = 'message';
      }, 3000);
    } else {
      messageEl.textContent = result.error || 'Не удалось извлечь поток. Возможно, станция недоступна или требует авторизации.';
      messageEl.className = 'message error';
    }
  } catch (error) {
    console.error('Ошибка извлечения потока:', error);
    messageEl.textContent = 'Ошибка при извлечении потока: ' + error.message;
    messageEl.className = 'message error';
  }
}

// Извлечение потока из RadioPotok
async function extractRadioPotokStream() {
  const urlInput = document.getElementById('stationUrl');
  const messageEl = document.getElementById('addStationMessage');
  const radiopotokUrl = urlInput.value.trim();
  
  if (!radiopotokUrl) {
    messageEl.textContent = 'Введите URL скрипта RadioPotok (например: https://radiopotok.ru/f/script6.1/4.js)';
    messageEl.className = 'message error';
    return;
  }
  
  if (!radiopotokUrl.includes('radiopotok.ru')) {
    messageEl.textContent = 'URL должен содержать radiopotok.ru';
    messageEl.className = 'message error';
    return;
  }
  
  messageEl.textContent = 'Извлечение потока из RadioPotok...';
  messageEl.className = 'message';
  
  try {
    // Использовать IPC для извлечения потока (обход CORS)
    const result = await window.AppAPI.extractRadioPotokStream(radiopotokUrl);
    
    if (result.success && result.streamUrl) {
      // Заполнить поля формы
      urlInput.value = result.streamUrl;
      if (result.stationName && !document.getElementById('stationName').value) {
        document.getElementById('stationName').value = result.stationName;
      }
      
      messageEl.textContent = 'Поток успешно извлечен из RadioPotok!';
      messageEl.className = 'message success';
      
      setTimeout(() => {
        messageEl.textContent = '';
        messageEl.className = 'message';
      }, 3000);
    } else {
      messageEl.textContent = result.error || 'Не удалось извлечь поток. Возможно, станция недоступна или использует защищенный поток.';
      messageEl.className = 'message error';
    }
  } catch (error) {
    console.error('Ошибка извлечения потока:', error);
    messageEl.textContent = 'Ошибка при извлечении потока: ' + error.message;
    messageEl.className = 'message error';
  }
}

// Таймер сна
function startSleepTimer(durationMinutes) {
  stopSleepTimer(); // Остановить предыдущий таймер если есть
  
  const durationMs = durationMinutes * 60 * 1000;
  const sleepTimerStatus = document.getElementById('sleepTimerStatus');
  const startSleepTimerBtn = document.getElementById('startSleepTimerBtn');
  const stopSleepTimerBtn = document.getElementById('stopSleepTimerBtn');
  
  state.sleepTimer = {
    startTime: Date.now(),
    duration: durationMs,
    endTime: Date.now() + durationMs
  };
  
  state.settings.sleepTimer.duration = durationMinutes;
  saveData();
  
  if (startSleepTimerBtn) startSleepTimerBtn.style.display = 'none';
  if (stopSleepTimerBtn) stopSleepTimerBtn.style.display = 'inline-block';
  
  // Обновлять статус каждую секунду
  const updateStatus = () => {
    if (!state.sleepTimer) return;
    
    const remaining = Math.max(0, state.sleepTimer.endTime - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    
    if (sleepTimerStatus) {
      sleepTimerStatus.textContent = `Остановка через: ${minutes}:${seconds.toString().padStart(2, '0')}`;
      sleepTimerStatus.style.display = 'block';
      sleepTimerStatus.className = 'message';
    }
    
    if (remaining <= 0) {
      stopSleepTimer();
      stopPlay();
      if (sleepTimerStatus) {
        sleepTimerStatus.textContent = 'Таймер сработал. Воспроизведение остановлено.';
        sleepTimerStatus.className = 'message success';
      }
    } else {
      setTimeout(updateStatus, 1000);
    }
  };
  
  updateStatus();
}

function stopSleepTimer() {
  if (state.sleepTimer) {
    state.sleepTimer = null;
  }
  
  const sleepTimerStatus = document.getElementById('sleepTimerStatus');
  const startSleepTimerBtn = document.getElementById('startSleepTimerBtn');
  const stopSleepTimerBtn = document.getElementById('stopSleepTimerBtn');
  
  if (sleepTimerStatus) {
    sleepTimerStatus.style.display = 'none';
  }
  if (startSleepTimerBtn) startSleepTimerBtn.style.display = 'inline-block';
  if (stopSleepTimerBtn) stopSleepTimerBtn.style.display = 'none';
}

// Планировщик
function initScheduler() {
  if (!state.settings.scheduler) {
    state.settings.scheduler = { enabled: false, schedules: [] };
  }
  
  if (!state.settings.scheduler.schedules) {
    state.settings.scheduler.schedules = [];
  }
  
  // Проверять расписание каждую секунду для точности
  if (state.scheduler) {
    clearInterval(state.scheduler);
  }
  
  state.scheduler = setInterval(() => {
    checkSchedules();
  }, 1000); // Проверка каждую секунду для точности
  
  // Проверить сразу
  checkSchedules();
}

function stopScheduler() {
  if (state.scheduler) {
    clearInterval(state.scheduler);
    state.scheduler = null;
  }
}

function checkSchedules() {
  if (!state.settings.scheduler?.enabled || !state.settings.scheduler.schedules) {
    return;
  }
  
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const currentDay = now.getDay(); // 0 = воскресенье, 1 = понедельник, ..., 6 = суббота
  
  state.settings.scheduler.schedules.forEach(schedule => {
    if (!schedule.enabled) return;
    
    // Проверить время (с точностью до минуты, секунды игнорируем)
    if (schedule.time !== currentTime) return;
    
    // Проверить, не было ли уже срабатывание в эту минуту (избежать повторных запусков)
    const lastTriggerKey = `schedule_${schedule.stationId}_${schedule.time}_${currentDay}`;
    const lastTrigger = state.schedulerLastTrigger || {};
    if (lastTrigger[lastTriggerKey] === currentTime) {
      return; // Уже сработало в эту минуту
    }
    
    // Проверить день недели
    if (schedule.days && schedule.days.length > 0) {
      if (!schedule.days.includes(currentDay)) return;
    }
    
    // Найти станцию
    const station = state.stations.find(s => s.id === schedule.stationId);
    if (!station) return;
    
    // Проверить, не играет ли уже эта станция
    if (state.currentStation?.id === schedule.stationId && state.isPlaying) {
      return;
    }
    
    // Запомнить время срабатывания
    if (!state.schedulerLastTrigger) {
      state.schedulerLastTrigger = {};
    }
    state.schedulerLastTrigger[lastTriggerKey] = currentTime;
    
    // Включить станцию
    playStation(station);
  });
  
  // Очистить старые записи о срабатываниях (старше текущей минуты)
  if (state.schedulerLastTrigger) {
    Object.keys(state.schedulerLastTrigger).forEach(key => {
      const storedTime = state.schedulerLastTrigger[key];
      if (storedTime !== currentTime) {
        delete state.schedulerLastTrigger[key];
      }
    });
  }
}

function renderSchedules() {
  const container = document.getElementById('schedulesList');
  if (!container) return;
  
  if (!state.settings.scheduler?.schedules || state.settings.scheduler.schedules.length === 0) {
    container.innerHTML = '<p style="color: var(--md-on-surface-variant); margin: 10px 0;">Нет расписаний. Добавьте новое расписание.</p>';
    return;
  }
  
  container.innerHTML = state.settings.scheduler.schedules.map((schedule, index) => {
    const station = state.stations.find(s => s.id === schedule.stationId);
    const stationName = station ? station.name : `Станция ${schedule.stationId}`;
    const daysNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const daysStr = schedule.days && schedule.days.length > 0 
      ? schedule.days.map(d => daysNames[d]).join(', ')
      : 'Каждый день';
    
    return `
      <div class="schedule-item" style="border: 1px solid var(--md-outline-variant); border-radius: 8px; padding: 12px; margin-bottom: 10px; background: var(--md-surface-container-low);">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <div style="font-weight: 500; margin-bottom: 5px;">${escapeHtml(stationName)}</div>
            <div style="font-size: 0.9em; color: var(--md-on-surface-variant);">
              Время: ${escapeHtml(schedule.time)} | Дни: ${escapeHtml(daysStr)}
            </div>
            <div style="font-size: 0.85em; color: var(--md-on-surface-variant); margin-top: 5px;">
              Статус: ${schedule.enabled ? '✅ Включено' : '❌ Выключено'}
            </div>
          </div>
          <div style="display: flex; gap: 5px;">
            <button class="btn btn-secondary" onclick="toggleSchedule(${index})" style="padding: 5px 10px; font-size: 0.85em;">
              ${schedule.enabled ? '⏸' : '▶'}
            </button>
            <button class="btn btn-secondary" onclick="editSchedule(${index})" style="padding: 5px 10px; font-size: 0.85em;">✏️</button>
            <button class="btn btn-secondary" onclick="deleteSchedule(${index})" style="padding: 5px 10px; font-size: 0.85em;">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Глобальные функции для обработчиков onclick в расписаниях
window.toggleSchedule = function(index) {
  if (state.settings.scheduler?.schedules?.[index]) {
    state.settings.scheduler.schedules[index].enabled = !state.settings.scheduler.schedules[index].enabled;
    saveData();
    renderSchedules();
  }
};

window.editSchedule = function(index) {
  const schedule = state.settings.scheduler?.schedules?.[index];
  if (!schedule) return;
  
  openScheduleModal(index);
};

window.deleteSchedule = function(index) {
  if (!state.settings.scheduler?.schedules?.[index] || !confirm('Удалить это расписание?')) return;
  state.settings.scheduler.schedules.splice(index, 1);
  saveData();
  renderSchedules();
};

function addSchedule() {
  if (!state.settings.scheduler) {
    state.settings.scheduler = { enabled: true, schedules: [] };
  }
  
  if (!state.settings.scheduler.schedules) {
    state.settings.scheduler.schedules = [];
  }
  
  openScheduleModal();
}

// Открыть модальное окно для добавления/редактирования расписания
function openScheduleModal(editIndex = null) {
  const modal = document.getElementById('scheduleModal');
  const title = document.getElementById('scheduleModalTitle');
  const stationSelect = document.getElementById('scheduleStationSelect');
  const timeInput = document.getElementById('scheduleTime');
  const editingIndexInput = document.getElementById('editingScheduleIndex');
  const messageEl = document.getElementById('scheduleModalMessage');
  
  if (!modal) return;
  
  // Очистить сообщения
  if (messageEl) {
    messageEl.style.display = 'none';
    messageEl.textContent = '';
    messageEl.className = 'message';
  }
  
  // Заполнить список станций
  stationSelect.innerHTML = '<option value="">Выберите станцию...</option>';
  state.stations.forEach(station => {
    const option = document.createElement('option');
    option.value = station.id;
    option.textContent = station.name;
    stationSelect.appendChild(option);
  });
  
  // Если редактирование - заполнить форму
  if (editIndex !== null && editIndex !== undefined) {
    const schedule = state.settings.scheduler.schedules[editIndex];
    if (schedule) {
      title.textContent = 'Редактировать расписание';
      stationSelect.value = schedule.stationId;
      
      // Преобразовать время из формата HH:MM в формат для input[type="time"]
      if (schedule.time) {
        timeInput.value = schedule.time;
      }
      
      // Установить дни недели
      document.querySelectorAll('.day-checkbox').forEach(checkbox => {
        checkbox.checked = schedule.days ? schedule.days.includes(parseInt(checkbox.value)) : false;
      });
      
      editingIndexInput.value = editIndex;
    }
  } else {
    title.textContent = 'Добавить расписание';
    stationSelect.value = '';
    timeInput.value = '';
    document.querySelectorAll('.day-checkbox').forEach(checkbox => {
      checkbox.checked = false;
    });
    editingIndexInput.value = '';
  }
  
  modal.style.display = 'flex';
}

// Закрыть модальное окно
window.closeScheduleModal = function() {
  const modal = document.getElementById('scheduleModal');
  if (modal) {
    modal.style.display = 'none';
  }
};

// Сохранить расписание
function saveSchedule() {
  const stationSelect = document.getElementById('scheduleStationSelect');
  const timeInput = document.getElementById('scheduleTime');
  const editingIndexInput = document.getElementById('editingScheduleIndex');
  const messageEl = document.getElementById('scheduleModalMessage');
  
  if (!stationSelect || !timeInput) return;
  
  const stationId = stationSelect.value;
  const time = timeInput.value;
  
  // Валидация
  if (!stationId) {
    if (messageEl) {
      messageEl.textContent = 'Выберите станцию';
      messageEl.className = 'message error';
      messageEl.style.display = 'block';
    }
    return;
  }
  
  if (!time) {
    if (messageEl) {
      messageEl.textContent = 'Введите время включения';
      messageEl.className = 'message error';
      messageEl.style.display = 'block';
    }
    return;
  }
  
  // Преобразовать время из формата HH:MM (input[type="time"]) в формат HH:MM
  const timeParts = time.split(':');
  const formattedTime = `${timeParts[0]}:${timeParts[1]}`;
  
  // Получить выбранные дни недели
  const selectedDays = [];
  document.querySelectorAll('.day-checkbox:checked').forEach(checkbox => {
    selectedDays.push(parseInt(checkbox.value));
  });
  
  const editIndex = editingIndexInput.value !== '' ? parseInt(editingIndexInput.value) : null;
  
  if (editIndex !== null && editIndex !== undefined && !isNaN(editIndex)) {
    // Редактирование существующего расписания
    const schedule = state.settings.scheduler.schedules[editIndex];
    if (schedule) {
      schedule.stationId = stationId;
      schedule.time = formattedTime;
      schedule.days = selectedDays.length > 0 ? selectedDays : null;
    }
  } else {
    // Добавление нового расписания
    state.settings.scheduler.schedules.push({
      stationId: stationId,
      time: formattedTime,
      days: selectedDays.length > 0 ? selectedDays : null,
      enabled: true
    });
  }
  
  saveData();
  renderSchedules();
  closeScheduleModal();
}

// Запуск приложения после загрузки DOM и всех скриптов
function startApp() {
  // Проверить что все необходимые модули загружены
  const checkModules = () => {
    const modules = {
      AppAPI: !!window.AppAPI,
      getDefaultStations: !!window.getDefaultStations
    };
    
    if (!modules.AppAPI || !modules.getDefaultStations) {
      return false;
    }
    return true;
  };
  
  if (!checkModules()) {
    // Попробовать еще раз через небольшую задержку
    setTimeout(() => {
      if (!checkModules()) {
        const missing = [];
        if (!window.AppAPI) missing.push('api-adapter.js');
        if (!window.getDefaultStations) missing.push('stations.js');
        logError('ОШИБКА: Не загружены модули: ' + missing.join(', ') + '. Проверьте порядок загрузки скриптов.');
        // Попробовать еще раз через 1 секунду
        setTimeout(startApp, 1000);
      } else {
        init();
      }
    }, 300);
  } else {
    init();
  }
}

// Делаем playStation доступной глобально для мобильной версии
window.playStation = playStation;

// Ждем загрузки всех скриптов
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Дополнительная задержка для гарантии загрузки всех скриптов
    setTimeout(startApp, 200);
  });
} else {
  // DOM уже загружен, но скрипты могут еще загружаться
  setTimeout(startApp, 200);
}
