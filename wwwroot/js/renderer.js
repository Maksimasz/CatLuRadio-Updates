// Предустановленные станции больше не используются отдельно
// Все станции хранятся в state.stations

// Состояние приложения
let state = {
  stations: [],
  favorites: [],
  history: [], // История прослушанных станций (последние 50)
  currentStation: null,
  ytQueue: null, // Очередь YouTube-плейлиста: { stationId, tracks, index, misses }
  audio: null,
  isPlaying: false,
  volume: 0.5, // Громкость по умолчанию 50%
  nativeAudio: false,
  // Перемотка YouTube: позиция и длительность текущего трека в миллисекундах
  // (событие nativeTime хоста). length <= 0 — живой поток, полоса скрыта.
  nativeTime: 0,
  nativeLength: 0,
  // Пользователь тянет полосу: события позиции не должны заслонять превью.
  seekDragging: false,
  isClosing: false,
  isStopping: false, // Флаг для отслеживания программной остановки
  isSwitching: false, // Флаг для предотвращения множественных переключений
  sleepTimer: null, // Таймер сна
  scheduler: null, // Планировщик
  schedulerLastTrigger: {}, // Последние срабатывания планировщика (для избежания повторных запусков)
  settings: {
    language: 'auto',
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
    normalization: {
      enabled: true // Выравнивание громкости станций (компрессор)
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
// Потоки, которые не играют с Web Audio (сервер без CORS) — играют без обработки
state.streamsWithoutWebAudio = new Set();

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
const t = (key, vars) => {
  if (window.TranslationManager) {
    return window.TranslationManager.t(key, vars);
  }
  return key;
};

// Перерисовка динамических текстов после смены языка: статика переведена
// проходом по DOM, а списки и заголовки пересоздаются с новым языком.
// Назначается TranslationManager.onApplied до старта init().
function refreshLanguageUI() {
  try {
    loadStations();
    renderFavorites();
    renderHistory();
    renderSchedules();
    if (state.currentStation) updateNowPlaying(state.currentStation.name || '—');
    updatePlayButton();
    // Блок диагностики эквалайзера хранит сырой шаблон — перевыполняем его
    const eqDebug = document.getElementById('equalizerDebug');
    if (eqDebug && eqDebug.__i18n) {
      eqDebug.textContent = t(eqDebug.__i18n.key, eqDebug.__i18n.vars);
    }
  } catch (e) {
    console.error('[i18n] refreshLanguageUI:', e);
  }
}
if (window.TranslationManager) {
  window.TranslationManager.onApplied = refreshLanguageUI;
}

// Функция getDefaultStations() теперь находится в stations.js

// Функция для отображения критических ошибок (только в консоли)
function logError(message, error = null) {
  if (error) {
    console.error(message, error);
  } else {
    console.error(message);
  }
}


// Всплывающее уведомление вместо alert(): системное окно блокирует выполнение
// кода — при серии ошибок воспроизведения пользователь получал стопку одинаковых
// диалогов, которые приходилось закрывать руками. Тост ничего не блокирует,
// оформляется стилем приложения и сам исчезает.
function showToast(message, type = 'info', durationMs = 0) {
  // Локализация готового текста: статичные тосты переводятся автоматически
  if (window.TranslationManager) message = window.TranslationManager.localize(message);
  const root = document.getElementById('toastRoot');
  if (!root) {
    // Контейнера ещё нет — сообщение не теряем, но и не падаем.
    console.warn('[toast]', message);
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'toast toast--' + type;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const text = document.createElement('div');
  text.className = 'toast__text';
  // textContent, а не innerHTML: в сообщениях попадаются URL потоков.
  text.textContent = message;
  toast.appendChild(text);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast__close';
  close.setAttribute('aria-label', t('Закрыть уведомление'));
  close.textContent = '×';
  close.addEventListener('click', () => toast.remove());
  toast.appendChild(close);

  root.appendChild(toast);

  // Не больше четырёх уведомлений одновременно: ошибки приходят пачками.
  while (root.children.length > 4) {
    root.firstElementChild.remove();
  }

  // Ошибки держим дольше — в них бывает URL потока и подсказка, что делать.
  const ttl = durationMs || (type === 'error' ? 12000 : 6000);
  setTimeout(() => toast.remove(), ttl);
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
  window.AppAPI.log?.(`init ${Math.round(performance.now() - initStartTime)} мс`);
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
        normalization: {
          ...state.settings.normalization,
          ...(savedSettings.normalization || {})
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
    // Избранное хранит только id: чистка при старте обязана щадить такие станции,
    // иначе ссылка остаётся в никуда, а избранное выглядит пустым.
    const favoriteIds = new Set(Array.isArray(state.favorites) ? state.favorites : []);
    
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
      // Сохранить ВСЕ пользовательские: добавленные вручную и из онлайн-поиска (user-),
      // импортированные (imported_), YouTube-плейлисты (yt-) и избранные —
      // единый критерий для всех веток чистки, см. StationCleanup.isUserAdded
      const userStations = state.stations.filter(s =>
        s.id && StationCleanup.isUserAdded(s, favoriteIds) && !defaultIds.has(s.id)
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
      // Дубликаты по ID и по URL: при конфликте выигрывает пользовательская
      // станция (StationCleanup), а не предустановленная. Раньше побеждал
      // первый встреченный: копия пользователя выбрасывалась, а предустановленное
      // с тем же URL потом уходило в «старые» — терялись обе.
      const { stations: uniqueStations, dropped } = StationCleanup.dedupe(state.stations, favoriteIds);

      if (dropped > 0) {
        console.log(`Удалено дубликатов: ${dropped}`);
        state.stations = uniqueStations;
        await window.AppAPI.saveStations(state.stations);
      }
      
      // Проверить, есть ли старые предустановленные станции, которых нет в новом списке
      // Пользовательские (user-/imported_/yt-) и избранные не трогаем — StationCleanup
      const oldDefaultStations = state.stations.filter(s =>
        s.id && !StationCleanup.isUserAdded(s, favoriteIds) && !defaultIds.has(s.id)
      );
      
      // Проверить, все ли предустановленные станции присутствуют
      const existingDefaultIds = new Set(state.stations.filter(s => defaultIds.has(s.id)).map(s => s.id));
      const missingDefaults = defaultStationsList.filter(s => !existingDefaultIds.has(s.id));
      
      if (oldDefaultStations.length > 0 || missingDefaults.length > 0) {
        // Оставить только проверенные предустановленные и пользовательские
        // (в том числе YouTube-плейлисты yt-) — критерий см. StationCleanup
        const userStations = state.stations.filter(s =>
          s.id && StationCleanup.isUserAdded(s, favoriteIds) && !defaultIds.has(s.id)
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

    // Восстановление из избранного: оно хранит только id. Если станция
    // пропала из списка (старые версии выкидывали её при чистке), достаём
    // полный объект из истории — иначе избранное навсегда останется пустым.
    const knownIds = new Set(state.stations.map(s => s.id));
    const restoredFromHistory = [];
    for (const id of (Array.isArray(state.favorites) ? state.favorites : [])) {
      if (knownIds.has(id)) continue;
      const fromHistory = (Array.isArray(state.history) ? state.history : [])
        .find(h => h && h.id === id);
      if (fromHistory) {
        state.stations.push({ ...fromHistory });
        knownIds.add(id);
        restoredFromHistory.push(id);
      }
    }
    if (restoredFromHistory.length) {
      console.log('Восстановлено из истории по избранному:', restoredFromHistory.length);
      await window.AppAPI.saveStations(state.stations);
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

// Отложенное сохранение громкости. Слайдер шлёт десятки input-событий в
// секунду, а каждое saveData() — это IPC + полный JSON стора (станции,
// история) на диск: UI-поток подвисал, очередь сообщений росла, и
// setNativeVolume доезжал с опозданием — громкость «плавала» позади
// ползунка. Теперь — один сохранённый настройки через 400 мс тишины,
// а по отпусканию ползунка (change) — немедленно.
let volumeSaveTimer = null;
function saveVolumeSettings() {
  window.AppAPI.saveSettings({ ...state.settings, volume: state.volume })
    .catch((error) => logError('Не удалось сохранить громкость:', error));
}
function scheduleVolumeSave() {
  if (volumeSaveTimer) clearTimeout(volumeSaveTimer);
  volumeSaveTimer = setTimeout(() => {
    volumeSaveTimer = null;
    saveVolumeSettings();
  }, 400);
}
function flushVolumeSave() {
  if (volumeSaveTimer) {
    clearTimeout(volumeSaveTimer);
    volumeSaveTimer = null;
  }
  saveVolumeSettings();
  // Один лог на жест (change, не input): в app.log видно, с каким значением
  // ползунок реально ушёл в хост — «значение или механизм» при жалобе на тихий
  // YouTube после движения ползунка.
  window.AppAPI.log?.(`громкость: ${state.volume}`);
}

// Автозапуск при старте упирается в политику autoplay Chromium: без жеста
// пользователя play() отклоняется NotAllowedError. Вместо ошибки ждём первого
// касания/клавиши и запускаем станцию уже с разрешения браузера.
function startAfterUserGesture(audioElement) {
  const onGesture = () => {
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
    if (state.isStopping || state.audio !== audioElement) return;
    audioElement.play().catch(err => console.error('Автозапуск после жеста не удался:', err));
  };
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
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
          <div class="station-sub">
            <span>${escapeHtml(portalLabel(station))}</span>
            <span class="station-time">${timeStr}</span>
          </div>
        </div>
        <div class="station-actions">
          <button class="btn-icon btn-favorite ${isFavorite(station.id) ? 'active' : ''}" 
                  data-action="toggle-favorite" data-station-id="${escapeHtml(station.id)}" title="${t('Избранное')}">
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
  
  // Установить язык ('auto' — определяется по системе; иное — по умолчанию auto)
  const validLangs = ['auto', 'ru', 'en', 'lt', 'he'];
  if (!validLangs.includes(state.settings.language)) state.settings.language = 'auto';
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

// Загрузка станций — только отрисовка, без записи в хранилище
function loadStations() {
  // Раньше при пустом списке здесь подставлялись предустановленные станции
  // и тут же сохранялись — а вызваться функция успевала ДО loadData():
  // TranslationManager зовёт refreshLanguageUI() на DOMContentLoaded,
  // а старт приложения (startApp → init) отложен на 200 мс. Хранилище
  // затиралось предустановленными при каждом запуске, и всё добавленное
  // после поставки (станции онлайн-поиска, YouTube-плейлисты) пропадало,
  // а избранное и история, лежащие в других ключах, оставались на месте.
  if (!state.stations || state.stations.length === 0) {
    logError('ВНИМАНИЕ: Нет станций для отображения! Количество станций: ' + (state.stations ? state.stations.length : 'undefined'));
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
    container.innerHTML = `<p class="empty-message">${t('Станции не найдены')}</p>`;
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
    container.innerHTML = `<p class="empty-message">${t('Станции не найдены')}</p>`;
    return;
  }
  
  const cards = group => group.map(station => `
    <div class="station-item ${state.currentStation?.id === station.id && state.isPlaying ? 'playing' : ''} ${state.stationHealth[station.id] === false ? 'offline' : ''}" 
         data-station-id="${escapeHtml(station.id)}">
      <div class="station-info">
        <div class="station-name">${escapeHtml(station.name)}</div>
        <div class="station-sub">${escapeHtml(portalLabel(station))}</div>
      </div>
      <div class="station-actions">
        ${isUserStation(station.id) ? `
          <button class="btn-icon btn-edit" 
                  data-action="edit-station" data-station-id="${escapeHtml(station.id)}" title="${t('Редактировать')}">
            ✏️
          </button>
          <button class="btn-icon btn-delete" 
                  data-action="delete-station" data-station-id="${escapeHtml(station.id)}" title="${t('Удалить')}">
            🗑️
          </button>
        ` : ''}
        <button class="btn-icon btn-favorite ${isFavorite(station.id) ? 'active' : ''}" 
                data-action="toggle-favorite" data-station-id="${escapeHtml(station.id)}" title="${t('Избранное')}">
          ${isFavorite(station.id) ? '❤️' : '🤍'}
        </button>
      </div>
    </div>
  `).join('');
  // YouTube-плейлисты и одиночные видео живут в своём разделе «YouTube»,
  // а не вперемешку с «Другая»: им нечего искать по странам, важен сам
  // плейлист. Раздел — первым в списке, остальные группы как раньше.
  const isYoutubeStation = station =>
    station.type === 'youtube-playlist' || (typeof station.id === 'string' && station.id.startsWith('yt-'));
  const ytStations = filtered.filter(isYoutubeStation);
  const countries = new Map();
  filtered.filter(s => !isYoutubeStation(s)).forEach(station => countries.set(station.country, [...(countries.get(station.country) || []), station]));
  const groups = [];
  if (ytStations.length) groups.push(['YouTube', ytStations]);
  [...countries]
    .sort(([a], [b]) => getCountryName(a).localeCompare(getCountryName(b), 'ru'))
    .forEach(([country, group]) => groups.push([getCountryName(country), group]));
  container.innerHTML = groups
    .map(([title, group], index) => `
      <details class="country-group" ${index === 0 ? 'open' : ''}>
        <summary>${escapeHtml(title)}<span>${group.length}</span></summary>
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
        <div class="station-sub">${escapeHtml(portalLabel(station))}</div>
      </div>
      <div class="station-actions">
        ${isUserStation(station.id) ? `
          <button class="btn-icon btn-edit" 
                  data-action="edit-station" data-station-id="${escapeHtml(station.id)}" title="${t('Редактировать')}">
            ✏️
          </button>
          <button class="btn-icon btn-delete" 
                  data-action="delete-station" data-station-id="${escapeHtml(station.id)}" title="${t('Удалить')}">
            🗑️
          </button>
        ` : ''}
        <button class="btn-icon btn-favorite active" 
                data-action="toggle-favorite" data-station-id="${escapeHtml(station.id)}" title="${t('Избранное')}">
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

// Применить громкость к активному плееру: через gain графа Web Audio, если
// элемент подключён к обработке звука, иначе напрямую к элементу
function applyPlaybackVolume(volume) {
  if (!state.audio) return;
  if (state.equalizer && state.equalizer.isAttachedTo(state.audio)) {
    state.equalizer.setVolume(volume);
  } else {
    state.audio.volume = volume;
  }
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
  
  // Если элемент подключён к графу Web Audio, его реальная громкость задаётся
  // gain графа — сам элемент плавно доводим до 1.0, а не до state.volume
  const targetVolume = (state.equalizer && state.equalizer.isAttachedTo(audioElement)) ? 1 : state.volume;
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

  // YouTube-плейлист — очередь треков, у неё свой путь запуска
  if (station.type === 'youtube-playlist') {
    return playYoutubeStation(station);
  }
  
  // Установить флаг переключения
  state.isSwitching = true;

  await window.AppAPI.stopNative();
  state.nativeAudio = false;

  // Переключение с YouTube на обычную станцию: радио играет тем же LibVLC,
  // но очередь YouTube и последняя длительность иначе переживают смену
  // станции — гейт `ytQueue && nativeLength > 0` проходил на устаревших
  // значениях и панель перемотки оставалась видна поверх радио
  // (жалоба 2026-10-08: «при проигрывании станции меню ютуба не исчезает»).
  state.ytQueue = null;
  resetSeekState();

  const crossfadeEnabled = state.settings.crossfade && state.settings.crossfade.enabled;
  const crossfadeDuration = state.settings.crossfade ? state.settings.crossfade.duration : 2000;
  const useCrossfade = crossfadeEnabled && state.audio && state.isPlaying;
  
  // Сохранить ссылку на старое аудио для crossfade
  const oldAudio = state.audio;

  // HLS-инстанс прежней станции забираем под контроль: при кроссфейде чистка
  // state.hls в playStation пропускается, и живой инстанс переподключает
  // MediaSource к уже остановленному элементу и сам вызывает play() — старая
  // станция продолжает «играть» в тишине. Гасим его вместе со старым аудио.
  const oldHls = state.hls;
  state.hls = null;
  const stopOldHls = () => {
    if (!oldHls) return;
    try { oldHls.stopLoad(); oldHls.detachMedia(); oldHls.destroy(); } catch (e) {}
  };
  
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
    // При crossfade старое аудио продолжает играть, пока новое не начнётся.
    // Глушим его собственным таймером, а не по событию playing нового
    // элемента: если новая станция браузером не поддержана (ошибка, запуск
    // через LibVLC) события playing не бывает — раньше старая играла вечно,
    // и звучали две станции сразу.
    let oldAudioStopped = false;
    const stopOldAudio = () => {
      if (oldAudioStopped) return;
      oldAudioStopped = true;
      try {
        if (oldAudio && oldAudio !== state.audio) {
          oldAudio.pause();
          oldAudio.src = '';
          oldAudio.load();
        }
      } catch (e) {
        // Игнорировать ошибки
      }
      stopOldHls();
    };
    fadeOutVolume(oldAudio, crossfadeDuration, stopOldAudio);
    setTimeout(stopOldAudio, crossfadeDuration + 500);
    state.audio = null;
  }

  // HLS прежней станции гасим сразу; при кроссфейде он умирает вместе с
  // остановкой старого аудио, чтобы fade out не прерывался.
  if (!(oldAudio && useCrossfade)) stopOldHls();
  
  // Проверить валидность URL
  if (!station.url || !station.url.trim()) {
    state.isSwitching = false;
    showToast(t('Ошибка: не указан URL станции'), 'error');
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
    showToast(t('Ошибка: неверный формат URL станции'), 'error');
    return;
  }

  // LibVLC — основной движок: он ждёт начало вывода звука. Нативно играем
  // всегда, пока кроссфейд реально не нужен — он применяется только при
  // переключении с уже играющего <audio>. Раньше здесь проверялся сам факт
  // включённости настройки, и при дефолтном кроссфейде ВСЕ станции шли через
  // браузер: медленный буфер, Web Audio и CORS-рестарты вместо быстрого
  // старта LibVLC. Неподдержанный VLC-ом поток ниже падает в прежний
  // браузерный путь как резерв.
  if (!useCrossfade) {
    const nativeStartedAt = performance.now();
    const nativeResult = await window.AppAPI.playNative(streamUrl, state.volume);
    // Тайминг в app.log: консоль WebView2 недоступна, а «долго подключается»
    // без цифр диагностировать нечем.
    window.AppAPI.log?.(`станция «${station.name}»: LibVLC ${Math.round(performance.now() - nativeStartedAt)} мс, громкость ${state.volume}${nativeResult?.success ? '' : ' — неудача, браузерный резерв'}`);
    if (nativeResult?.success) {
      state.nativeAudio = true;
      // Эквалайзер — косметика: его сбой не должен ронять запуск станции.
      try {
        await window.AppAPI.setNativeEqualizer(state.settings.equalizer?.values || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      } catch (e) { console.warn('Эквалайзер LibVLC не применился:', e); }
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
  await playInBrowserPlayer({ station, streamUrl, useCrossfade, crossfadeDuration });
}


/**
 * YouTube-плейлист: очередь треков поверх LibVLC.
 *
 * Ссылки на аудио YouTube (googlevideo) живут несколько часов и привязаны к IP,
 * поэтому каждый трек резолвится непосредственно перед запуском
 * (AppAPI.resolveYoutubeTrack), а по естественному концу трека хост шлёт
 * событие nativeEnded — на нём очередь сама переходит к следующему.
 * Кроссфейд не применяется: треки разной длительности, и между ними LibVLC
 * сам ставит границу файла.
 */
async function playYoutubeStation(station) {
  if (state.isSwitching) return;

  // Общая остановка: гасит LibVLC, <audio>, HLS и сбрасывает прошлую очередь
  stopPlay();

  const tracks = Array.isArray(station.ytTracks) ? station.ytTracks : [];
  if (!tracks.length) {
    showToast(t('Плейлист пуст'), 'error');
    return;
  }

  state.isSwitching = true;
  state.currentStation = station;
  state.ytQueue = { stationId: station.id, tracks, index: 0, misses: 0 };
  await playYoutubeTrack(0);
}

/**
 * Запуск одного трека очереди: сначала резолв аудио-потока, потом playNative.
 * requestedIndex берётся по модулю длины — очередь зациклена как радио.
 */
async function playYoutubeTrack(requestedIndex) {
  const queue = state.ytQueue;
  if (!queue || !queue.tracks.length) {
    state.isSwitching = false;
    return;
  }

  const count = queue.tracks.length;
  queue.index = ((requestedIndex % count) + count) % count;
  const track = queue.tracks[queue.index];
  let started = false;
  // Новый трек: полоса гаснет до первого nativeTime от хоста — старая
  // позиция не должна пережить переключение.
  resetSeekState();

  try {
    const resolveStartedAt = performance.now();
    const resolved = await window.AppAPI.resolveYoutubeTrack(track.id);
    const resolveMs = Math.round(performance.now() - resolveStartedAt);
    if (!resolved?.success || !resolved.url) {
      window.AppAPI.log?.(`youtube: резолв ${resolveMs} мс, ошибка: ${resolved?.error || 'нет url'}`);
      await skipYoutubeTrack(track, resolved?.error);
      return;
    }

    const nativeStartedAt = performance.now();
    const nativeResult = await window.AppAPI.playNative(resolved.url, state.volume);
    // Тайминг в app.log: показывает, где именно теряются секунды между
    // кликом по YouTube-станции и началом звука.
    window.AppAPI.log?.(`youtube трек ${track.id}: резолв ${resolveMs} мс, старт VLC ${Math.round(performance.now() - nativeStartedAt)} мс, громкость ${state.volume}${nativeResult?.success ? '' : ' — неудача'}`);
    if (nativeResult?.success) {
      started = true;
      state.nativeAudio = true;
      // Эквалайзер — косметика поверх звука: его сбой (нет функции, таймаут
      // хоста) не должен ронять очередь. Раньше TypeError здесь останавливал
      // функцию до сброса isSwitching — очередь умирала после первого трека,
      // а повторный запуск молча не работал.
      try {
        await window.AppAPI.setNativeEqualizer(state.settings.equalizer?.values || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      } catch (e) { console.warn('Эквалайзер LibVLC не применился:', e); }
      state.isPlaying = true;
      queue.misses = 0;
      rememberLastStation(state.currentStation);
      state.isSwitching = false;
      updatePlayButton();
      const label = track.author ? `${track.title} — ${track.author}` : track.title;
      updateNowPlaying(label, track.title);
      renderStations(state.stations);
      renderFavorites();
      return;
    }
    await skipYoutubeTrack(track, t('LibVLC не начал воспроизведение'));
  } catch (error) {
    // Любая неожиданная ошибка не должна навечно заблокировать isSwitching:
    // трек уже играет — просто разблокируем управление, трек не запустился —
    // пропускаем его по общим правилам (три пропуска подряд и очередь встаёт).
    console.error('YouTube: сбой запуска трека:', error);
    if (started) {
      state.isSwitching = false;
      state.isPlaying = true;
      updatePlayButton();
    } else {
      await skipYoutubeTrack(track, error?.message || String(error));
    }
  }
}

/**
 * Трек недоступен (возрастной, региональный, истёкший манифест) — пропускаем.
 * После трёх неудач подряд останавливаемся: так полностью нерабочий плейлист
 * не крутится в вечном цикле.
 */
async function skipYoutubeTrack(track, error) {
  const queue = state.ytQueue;
  if (!queue) {
    state.isSwitching = false;
    return;
  }

  queue.misses = (queue.misses || 0) + 1;
  console.warn(`YouTube: трек «${track.title}» не играет (${error || 'нет аудио'}), пропускаем`);

  if (queue.misses >= Math.min(queue.tracks.length, 3)) {
    stopYoutubeQueue();
    showToast(t('Не удалось воспроизвести плейлист: {name}', { name: state.currentStation?.name || '' }), 'error');
    return;
  }

  // Пауза перед следующим: LibVLC только что отказал и должен отпустить поток
  await new Promise(resolve => setTimeout(resolve, 400));
  await playYoutubeTrack(queue.index + 1);
}

function stopYoutubeQueue() {
  state.ytQueue = null;
  state.isSwitching = false;
  state.isPlaying = false;
  window.AppAPI.stopNative();
  state.nativeAudio = false;
  updatePlayButton();
  updateNowPlaying('—');
}

// Событие nativeEnded: трек доиграл естественно — двигаем очередь дальше.
function handleNativeEnded() {
  const queue = state.ytQueue;
  if (!queue || state.isSwitching || !state.isPlaying) return;
  state.isSwitching = true;
  playYoutubeTrack(queue.index + 1).catch((error) => {
    console.error('Ошибка перехода к следующему треку YouTube:', error);
    state.isSwitching = false;
  });
}

// Событие nativeError: LibVLC умер посреди игры (обрыв сети, 403 от
// googlevideo). Без него страница не узнаёт о смерти плеера: очередь молчит,
// а кнопка Play вызывает resumeNative на мёртвом медиа и ничего не делает.
function handleNativeError() {
  const queue = state.ytQueue;
  if (queue && !state.isSwitching && state.isPlaying) {
    // Трактуем как неудачный трек: пропуск по общим правилам с лимитом в три.
    skipYoutubeTrack(queue.tracks[queue.index], 'LibVLC: ошибка потока').catch((error) => {
      console.error('Ошибка после обрыва потока LibVLC:', error);
      state.isSwitching = false;
    });
    return;
  }
  if (!state.nativeAudio || !state.isPlaying) return;
  console.warn('LibVLC: поток прервался, останавливаем воспроизведение');
  state.isPlaying = false;
  state.nativeAudio = false;
  resetSeekState();
  updatePlayButton();
  updateNowPlaying('—');
  showToast(t('Воспроизведение прервано: поток недоступен'), 'error');
}

// ——— Перемотка YouTube ———
// Полоса под названием трека в «Сейчас играет»: рисуется только пока играет
// очередь YouTube и хост сообщает длительность (Length > 0 у живого радио нет).

function resetSeekState() {
  state.nativeTime = 0;
  state.nativeLength = 0;
  state.seekDragging = false;
  updateSeekUI();
}

function formatSeekTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Событие nativeTime: позиция/длительность от хоста (раз в 250 мс).
function handleNativeTime(event) {
  const detail = (event && event.detail) || {};
  const time = Number(detail.time);
  const length = Number(detail.length);
  state.nativeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
  state.nativeLength = Number.isFinite(length) ? Math.max(0, length) : 0;
  updateSeekUI();
}

function updateSeekUI() {
  const controls = document.getElementById('seekControls');
  if (!controls) return;
  // Гейт двойной: без очереди YouTube полоса не нужна, без длительности
  // (живой поток, медиа снято) перемотывать нечего.
  const visible = Boolean(state.ytQueue) && state.nativeLength > 0;
  controls.style.display = visible ? '' : 'none';
  if (!visible) return;

  const totalEl = document.getElementById('seekTimeTotal');
  const currentEl = document.getElementById('seekTimeCurrent');
  const fill = document.getElementById('seekFill');
  if (totalEl) totalEl.textContent = formatSeekTime(state.nativeLength);
  // Пока ползунок в руках — превью позиции держит pointermove, не события.
  if (state.seekDragging) return;
  const pos = Math.min(state.nativeTime, state.nativeLength);
  if (fill) fill.style.width = (pos / state.nativeLength * 100) + '%';
  if (currentEl) currentEl.textContent = formatSeekTime(pos);
}

// Кнопки ±10 секунд и клик/перетаскивание по полосе.
function setupSeekControls() {
  const track = document.getElementById('seekTrack');
  const backBtn = document.getElementById('seekBackBtn');
  const fwdBtn = document.getElementById('seekFwdBtn');
  if (!track) return;

  const fractionFrom = (e) => {
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  const preview = (e) => {
    if (!(state.nativeLength > 0)) return undefined;
    const pos = fractionFrom(e) * state.nativeLength;
    const fill = document.getElementById('seekFill');
    const currentEl = document.getElementById('seekTimeCurrent');
    if (fill) fill.style.width = (pos / state.nativeLength * 100) + '%';
    if (currentEl) currentEl.textContent = formatSeekTime(pos);
    return pos;
  };

  track.addEventListener('pointerdown', (e) => {
    if (!state.ytQueue || !(state.nativeLength > 0)) return;
    state.seekDragging = true;
    try { track.setPointerCapture(e.pointerId); } catch (_) { /* capture — по желанию */ }
    preview(e);
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => {
    if (state.seekDragging) preview(e);
  });
  const commit = (e) => {
    if (!state.seekDragging) return;
    const pos = preview(e);
    state.seekDragging = false;
    if (pos !== undefined) {
      state.nativeTime = pos;
      window.AppAPI.seekNative(Math.round(pos));
    }
    updateSeekUI();
  };
  track.addEventListener('pointerup', commit);
  track.addEventListener('pointercancel', () => {
    state.seekDragging = false;
    updateSeekUI();
  });

  const nudge = (deltaSec) => {
    if (!state.ytQueue || !(state.nativeLength > 0)) return;
    const target = Math.min(Math.max(state.nativeTime + deltaSec * 1000, 0), state.nativeLength);
    state.nativeTime = target;
    window.AppAPI.seekNative(Math.round(target));
    updateSeekUI();
  };
  if (backBtn) backBtn.addEventListener('click', () => nudge(-10));
  if (fwdBtn) fwdBtn.addEventListener('click', () => nudge(10));

  // ⏮/⏭ — переключение треков очереди. Тот же заход, что у nativeEnded:
  // guard isSwitching от двойного клика, зацикленный переход через
  // playYoutubeTrack (счётчик по модулю длины — с последнего на первый).
  const switchTrack = (delta) => {
    const queue = state.ytQueue;
    if (!queue || state.isSwitching) return;
    state.isSwitching = true;
    playYoutubeTrack(queue.index + delta).catch((error) => {
      console.error('Ошибка переключения трека YouTube:', error);
      state.isSwitching = false;
    });
  };
  const prevBtn = document.getElementById('seekPrevTrackBtn');
  const nextBtn = document.getElementById('seekNextTrackBtn');
  if (prevBtn) prevBtn.addEventListener('click', () => switchTrack(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => switchTrack(1));
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
    
    // Станция с Web Audio (эквалайзер/выравнивание) не запустилась и ни разу не
    // играла — обычно сервер не отдаёт CORS-заголовки для crossOrigin='anonymous'.
    // Запоминаем поток и перезапускаем станцию уже без обработки, чтобы она
    // гарантированно играла (чёрный список живёт до перезагрузки страницы).
    if (retryState.canFallbackToNoWebAudio && !audioElement.__reachedPlaying) {
      retryState.canFallbackToNoWebAudio = false;
      state.streamsWithoutWebAudio.add(streamUrl);
      console.warn('Поток не запустился с Web Audio (нет CORS?) — перезапуск без обработки:', streamUrl);
      try {
        audioElement.pause();
        audioElement.src = '';
        audioElement.load();
      } catch (e) {
        // Игнорируем ошибки очистки элемента
      }
      if (state.equalizer) state.equalizer.releaseSourceFor(audioElement);
      if (state.audio === audioElement) state.audio = null;
      state.isSwitching = false;
      showToast(t('Станция играет без обработки звука:\nсервер не поддерживает режим CORS.'), 'info');
      playStation(station).catch(err => console.error('Ошибка перезапуска станции без обработки:', err));
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
        // Запуск через LibVLC: HLS-инстанс этой же станции глушим, иначе он
        // переподключит MediaSource и продолжит играть параллельно с VLC.
        if (state.hls) {
          try { state.hls.stopLoad(); state.hls.detachMedia(); state.hls.destroy(); } catch (e) {}
          state.hls = null;
        }
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
    
    let userErrorMessage = t('Ошибка загрузки станции: {name}', { name: station.name });
    if (errorCode === 2) {
      userErrorMessage += '\n' + t('Проблема с сетью. Проверьте подключение к интернету.');
    } else if (errorCode === 3) {
      userErrorMessage += '\n' + t('Ошибка декодирования аудио. Возможно, формат не поддерживается.');
    } else if (errorCode === 4) {
      userErrorMessage += '\n' + t('Поток не удалось открыть или его формат не поддерживается.');
    } else {
      userErrorMessage += '\n' + t('Код ошибки: {code}', { code: errorCode });
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
    showToast(userErrorMessage + '\n\n' + t('Рабочий резервный поток не найден.'), 'error');
  };
}

/**
 * Вешает обработчики <audio> на элемент: обновление статуса, кроссфейд,
 * повторные загрузки и запуск через LibVLC при ошибке (см. createStreamErrorHandler).
 */
function bindAudioElementEvents({ station, streamUrl, audioElement, contentType, useCrossfade, crossfadeDuration, retryState }) {
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
                    showToast(t('Ошибка воспроизведения: {name}\nПроверьте URL потока.', { name: station.name }), 'error');
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
                  showToast(t('Ошибка воспроизведения: {name}\nПоток не загружается.', { name: station.name }), 'error');
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
            } else if (error && error.name === 'NotAllowedError') {
              // Автозапуск без жеста пользователя — не ошибка, а ожидание:
              // станция запустится после первого касания/клавиши (см.
              // startAfterUserGesture), пугать сообщением не нужно.
              state.isSwitching = false;
              state.isPlaying = false;
              updatePlayButton();
              startAfterUserGesture(audioElement);
              showToast(t('Автозапуск ждёт нажатия: {name}\nНажмите в окне — станция продолжит.', { name: station.name }), 'info');
            } else {
              showToast(t('Ошибка воспроизведения: {name}\n{message}', { name: station.name, message: error.message }), 'error');
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
      audioElement.__reachedPlaying = true;
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
      
      // Fade out старой станции теперь делается в playStation в момент
      // переключения: от события playing нового элемента это зависеть не может,
      // иначе старая станция остаётся играть, когда новая не стартовала в вебе.
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
        if (error && error.name === 'NotAllowedError') {
          // Автозапуск без жеста — ждём касания/клавиши, см. startAfterUserGesture.
          state.isSwitching = false;
          state.isPlaying = false;
          startAfterUserGesture(audioElement);
          showToast(t('Автозапуск ждёт нажатия: {name}\nНажмите в окне — станция продолжит.', { name: station.name }), 'info');
          return;
        }
        showToast(t('Ошибка воспроизведения HLS потока: {name}', { name: station.name }), 'error');
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
    // Инстанс уже не текущий (станция переключена): восстановление ничего не
    // запускает, иначе он оживит старый аудио-элемент.
    if (state.hls !== hls) return;
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
          showToast(t('Ошибка загрузки HLS потока: {name}\nФормат аудио не поддерживается.\n\nURL: {url}', { name: station.name, url: streamUrl }), 'error');
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

async function playInBrowserPlayer({ station, streamUrl, useCrossfade, crossfadeDuration }) {
  const { contentType, isHLS, hlsSupported, useHLS } = detectStreamFormat(streamUrl);
  
  // Создать новый аудио элемент с правильными настройками
  const audioElement = new Audio();
  // Если используется crossfade, начать с нулевой громкости
  audioElement.volume = useCrossfade ? 0 : state.volume;
  audioElement.preload = 'auto';
  
  // Обработка звука (эквалайзер и/или выравнивание громкости) идёт через Web Audio
  // API. Для прямых потоков это требует crossOrigin='anonymous', а часть серверов
  // в CORS-режиме молчит — тогда станция по ошибке автоматически перезапускается
  // уже без обработки (см. createStreamErrorHandler, state.streamsWithoutWebAudio).
  const eqWanted = !!(state.settings.equalizer && state.settings.equalizer.enabled && window.Equalizer);
  const normWanted = !!(state.settings.normalization && state.settings.normalization.enabled !== false && window.Equalizer);
  const processingWanted = (eqWanted || normWanted) && !state.streamsWithoutWebAudio.has(streamUrl);
  if (processingWanted || useHLS) {
    audioElement.crossOrigin = 'anonymous';
  }
  
  // Инициализировать HLS если это HLS поток
  if (useHLS) {
    setupHlsSession({ audioElement, streamUrl, station, useCrossfade, crossfadeDuration });
  } else if (isHLS && !hlsSupported) {
    // HLS не поддерживается браузером
    showToast(t('HLS потоки (m3u8) не поддерживаются в этом браузере.\n\nПопробуйте использовать другой поток или обновить браузер.'), 'error');
    state.isSwitching = false;
    return;
  }
  
  // Подключаем Web Audio при обработке; иначе отвязываем прошлый элемент с
  // задержкой, чтобы затухающая при кроссфейде станция не обрывалась
  const releaseDelay = useCrossfade ? crossfadeDuration + 500 : 0;
  if (processingWanted) {
    if (!state.equalizer) {
      state.equalizer = new window.Equalizer();
    }
  } else if (state.equalizer) {
    state.equalizer.releaseSources(releaseDelay);
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
  
  // Инициализировать обработку ПОСЛЕ установки src (crossOrigin уже установлен)
  if (processingWanted && state.equalizer) {
    const eqAttached = state.equalizer.init(audioElement, {
      useEqualizer: eqWanted,
      useNormalization: normWanted,
      releaseDelay,
      volume: state.volume
    });
    if (eqAttached) {
      // Применить сохраненные настройки
      if (state.settings.equalizer.values) {
        state.equalizer.setValues(state.settings.equalizer.values);
      }
      if (state.settings.equalizer.preset) {
        state.equalizer.setPreset(state.settings.equalizer.preset);
      }
      // Элемент в графе: ползунок громкости работает через gain графа,
      // сам элемент держим на полной громкости (кроме кроссфейда — fade 0..1)
      if (!useCrossfade) {
        audioElement.volume = 1;
      }
    }
  }
  
  // Общее состояние повторных попыток (нужно обработчику ошибок и handleStalled)
  const retryState = { retryCount: 0, maxRetries: 2, terminalErrorPending: false, canFallbackToNoWebAudio: processingWanted && !useHLS };
  
  bindAudioElementEvents({ station, streamUrl, audioElement, contentType, useCrossfade, crossfadeDuration, retryState });
  
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
    showToast(t('Ошибка при загрузке станции: {name}', { name: station.name }), 'error');
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
    // Плеер встал (очередь остановлена после трёх пропусков, поток умер):
    // кнопка Play молча ничего не делала — «не запускается». Если станция
    // ещё помнится, запускаем её заново.
    if (state.currentStation) {
      playStation(state.currentStation).catch((error) => {
        console.error('Не удалось перезапустить станцию:', error);
      });
    }
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
  // Очередь YouTube живёт ровно до остановки: nativeEnded её больше не тронет
  state.ytQueue = null;
  resetSeekState();

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
    if (btn) btn.title = t('Пауза');
  } else {
    if (playIcon) playIcon.style.display = 'inline-block';
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (miniPlayIcon) miniPlayIcon.style.display = 'inline-block';
    if (miniPauseIcon) miniPauseIcon.style.display = 'none';
    if (btn) btn.title = t('Воспроизвести');
  }

  const hasAudio = Boolean(state.audio || state.nativeAudio);
  const playingId = hasAudio && state.currentStation ? state.currentStation.id : null;
  document.querySelectorAll('[data-preview-id]').forEach(el => {
    const active = playingId !== null && el.dataset.previewId === playingId;
    el.classList.toggle('is-playing', active);
    const ind = el.querySelector('.play-ind');
    if (ind) ind.textContent = active ? '■' : '▶';
  });
  if (btn) btn.disabled = !hasAudio;
  if (stopBtn) stopBtn.disabled = !hasAudio;
  if (miniStopBtn) miniStopBtn.disabled = !hasAudio;
}

// Обновление информации о текущей станции
function updateNowPlaying(stationName, titleOverride) {
  // Обновление медиа-сессии для мобильных устройств
  if ('mediaSession' in navigator && state.currentStation) {
    try {
      const station = state.currentStation;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: titleOverride || station.name || stationName || t('Радиостанция'),
        artist: station.genre || t('Интернет-радио'),
        album: 'CatLu Radio NET',
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
  // Пользовательские: добавленные вручную и из онлайн-поиска (user-),
  // импортированные (imported_) и YouTube-плейлисты (yt-)
  if (!state.settings.editMode) return false;
  return stationId && (stationId.startsWith('user-') || stationId.startsWith('imported_') || stationId.startsWith('yt-'));
}

// Используем модуль названий стран
function getCountryName(code) {
  const name = window.CountryNames ? window.CountryNames.getName(code) : code;
  // CountryNames хранит русские названия — переводим через словарь
  return t(name);
}

// «Имя портала» станции — строка под названием, всегда строчными буквами.
// Хранится в station.source (добавлено из онлайн-поиска); для станций,
// живущих в локальном списке, показываем портал самого приложения.
function portalLabel(station) {
  const source = station && station.source ? String(station.source).trim() : '';
  if (source) return source.toLowerCase();
  return 'catlu radio';
}

async function checkAllStations() {
  const button = document.getElementById('checkStationsBtn');
  const status = document.getElementById('stationCheckStatus');
  if (button.dataset.busy === 'true') return;
  button.dataset.busy = 'true';
  button.setAttribute('aria-disabled', 'true');
  status.textContent = t('Проверка…');
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
  status.textContent = t('Работают {working} из {total}', { working: working, total: state.stations.length });
  button.dataset.busy = 'false';
  button.removeAttribute('aria-disabled');
}

let availableUpdate = null;
let checkingUpdate = false;
async function checkForUpdates() {
  const status = document.getElementById('updateStatus');
  const install = document.getElementById('installUpdateBtn');
  const button = document.getElementById('checkUpdateBtn');
  // Повторный клик во время уже идущей проверки не нужен.
  if (!status || !install || checkingUpdate) return;
  checkingUpdate = true;
  const startedAt = performance.now();
  status.textContent = t('Проверка обновлений…');
  install.style.display = 'none';
  // Кнопка на время запроса явно «занята» (стиль .btn:disabled), иначе
  // быстрый ответ GitHub делает клик визуально мёртвым.
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  let result = null;
  try {
    result = await window.AppAPI.checkForUpdate();
  } catch (e) {
    console.error('[Обновления] Ошибка проверки:', e);
  }
  // Даже на мгновенном ответе фаза «Проверка…» обязана успеть
  // перерисоваться: жалоба 2026-10-08 — «кнопку забыли подключить».
  const elapsed = performance.now() - startedAt;
  if (elapsed < 450) await new Promise(resolve => setTimeout(resolve, 450 - elapsed));
  if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
  checkingUpdate = false;
  // Штамп времени: статус меняется при КАЖДОМ клике даже при том же
  // результате («Установлена последняя версия» до и после больше не выглядит
  // как отсутствие реакции).
  const stamp = ` ⏱ ${new Date().toTimeString().slice(0, 8)}`;
  if (!result?.success) {
    status.textContent = t('Не удалось проверить обновления.') + stamp;
    return;
  }
  if (!result.hasUpdate || !result.url) {
    status.textContent = t('Установлена последняя версия.') + stamp;
    return;
  }
  availableUpdate = result;
  status.textContent = t('Доступна версия {version}.', { version: result.version }) + stamp;
  install.textContent = t('Обновить до {version}', { version: result.version });
  install.style.display = 'inline-block';
}

async function installAvailableUpdate() {
  if (!availableUpdate?.url || !confirm(t('Скачать и установить версию {version}?', { version: availableUpdate.version }))) return;
  document.getElementById('updateStatus').textContent = t('Скачивание установщика…');
  const result = await window.AppAPI.installUpdate(availableUpdate.url);
  if (!result?.success) document.getElementById('updateStatus').textContent = t('Не удалось запустить обновление.');
}

async function searchOnlineStations() {
  const query = document.getElementById('onlineSearchInput').value.trim();
  const country = document.getElementById('onlineCountrySelect').value;
  const portal = document.getElementById('onlinePortalSelect').value;
  const results = document.getElementById('onlineResults');
  if (!query && country === 'all' && portal === 'all') {
    results.hidden = false;
    results.textContent = t('Введите название, стиль, исполнителя, годы или выберите страну.');
    return;
  }

  results.hidden = false;
  results.textContent = t('Поиск…');
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
    results.textContent = t('Работающие станции не найдены.');
    return;
  }

  stations.forEach(found => {
    const row = document.createElement('div');
    row.className = 'online-result';
    const previewStation = {
      id: `preview-online-${found.stationuuid || found.name}`,
      name: found.name,
      url: found.url_resolved || found.url || '',
      country: found.countrycode || 'OTHER',
      genre: (found.tags || 'Other').split(',')[0],
      image: found.favicon || '',
      preview: true
    };
    row.dataset.previewId = previewStation.id;

    const info = document.createElement('div');
    info.className = 'online-result-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'online-result-name';
    nameEl.textContent = found.name;
    const subEl = document.createElement('div');
    subEl.className = 'online-result-sub';
    subEl.textContent = (found.source || 'radio browser').toLowerCase();
    info.append(nameEl, subEl);

    const actions = document.createElement('div');
    actions.className = 'online-result-actions';
    const indicator = document.createElement('span');
    indicator.className = 'play-ind';
    indicator.textContent = '▶';
    indicator.title = t('Прослушать');

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'online-add';
    add.title = t('Добавить в плейлист');
    add.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>';
    const markAdded = () => {
      row.classList.add('in-playlist');
      add.classList.add('added');
      add.disabled = true;
      add.title = t('Уже в плейлисте');
      add.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    };
    if (isInPlaylist(found)) markAdded();

    add.addEventListener('click', async (event) => {
      event.stopPropagation();
      add.disabled = true;
      try {
        const urls = await Promise.all([found, ...found.backupSources].map(window.AppAPI.resolvePortalStation));
        const [url, ...backupUrls] = [...new Set(urls.filter(Boolean))];
        if (url && !state.stations.some(s => s.url === url)) {
          const station = { id: `user-online-${found.stationuuid || Date.now()}`, name: found.name, url, primaryUrl: url, backupUrls, country: found.countrycode || 'OTHER', genre: (found.tags || 'Other').split(',')[0], image: found.favicon || '', source: found.source || 'Radio Browser' };
          state.stations.push(station);
          state.stationHealth[station.id] = true;
          await saveData();
          document.getElementById('filterSelect').value = 'all';
          loadStations();
        }
        markAdded();
      } finally {
        if (!row.classList.contains('in-playlist')) add.disabled = false;
      }
    });

    // Клик по строке (кроме кнопок справа) — сразу проиграть станцию
    row.addEventListener('click', async () => {
      if (state.currentStation?.id === previewStation.id && (state.audio || state.nativeAudio)) return stopPlay();
      previewStation.url = await window.AppAPI.resolvePortalStation(found);
      if (previewStation.url) playStation(previewStation);
    });

    actions.append(indicator, add);
    row.append(info, actions);
    results.append(row);
  });
}

// Уже добавлена ли найденная станция в основной плейлист?
function isInPlaylist(found) {
  const url = found.url_resolved || found.url || '';
  const name = normalizedStationName(found.name);
  return state.stations.some(station => {
    if (url && (station.url === url || station.primaryUrl === url)) return true;
    if (!name || normalizedStationName(station.name) !== name) return false;
    if (!found.countrycode || !station.country || station.country === 'OTHER') return true;
    return station.country === found.countrycode;
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
    
    applyPlaybackVolume(volume);
    if (state.nativeAudio) window.AppAPI.setNativeVolume(volume);
    
    // Не saveData() на каждый input: полный JSON стора на каждое событие
    // слайдера и есть причина «плавающей» громкости (см. scheduleVolumeSave).
    scheduleVolumeSave();
  });
  // Отпустили ползунок — сохранить сразу, не дожидаясь дебаунса.
  volumeSlider.addEventListener('change', flushVolumeSave);

  // Перемотка YouTube: полоса и кнопки под названием трека в «Сейчас играет».
  setupSeekControls();
  
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
      
      applyPlaybackVolume(volume);
      if (state.nativeAudio) window.AppAPI.setNativeVolume(volume);
      
      scheduleVolumeSave();
    });
    // Отпустили ползунок — сохранить сразу, не дожидаясь дебаунса.
    miniVolumeSlider.addEventListener('change', flushVolumeSave);
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

  // Добавление YouTube-плейлиста по ссылке
  document.getElementById('addYtPlaylistBtn').addEventListener('click', addYoutubePlaylist);
  document.getElementById('ytPlaylistUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addYoutubePlaylist();
  });
  
  // Обновление станции (кнопка "Сохранить изменения")
  document.getElementById('updateStationBtn').addEventListener('click', async () => {
    const editingId = document.getElementById('editingStationId').value;
    if (editingId) {
      await updateStation(editingId);
    } else {
      showToast(t('Ошибка: не выбрана станция для редактирования'), 'error');
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
      if (confirm(t('Вы уверены, что хотите очистить историю прослушанных станций?'))) {
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
        if (confirm(t('Вы уверены, что хотите закрыть приложение?'))) {
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
        if (confirm(t('Вы уверены, что хотите закрыть приложение?'))) {
          window.close();
        }
      }
    });
  }
  
  // Эквалайзер
  initEqualizer();
}

// Показать отладочную информацию в интерфейсе
function showEqualizerDebug(message, isError = false, vars = null) {
  const debugEl = document.getElementById('equalizerDebug');
  if (debugEl) {
    // message — русский шаблон (ключ словаря, {placeholder} подставляются из
    // vars). Храним его на элементе, чтобы перевести блок заново при смене
    // языка (см. refreshLanguageUI): сам текст с подставленным числом ключом
    // словаря уже не является.
    debugEl.__i18n = { key: message, vars };
    debugEl.textContent = window.TranslationManager
      ? window.TranslationManager.t(message, vars)
      : message;
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
    bandsContainer.innerHTML = `<p style="color: red; padding: 16px; text-align: center;">${t('Ошибка создания эквалайзера. Слайдеры не были созданы.')}</p>`;
    return;
  }
  
  if (createdSliders.length !== frequencies.length) {
    showEqualizerDebug('ВНИМАНИЕ: Создано {created} слайдеров из {total}', false, { created: createdSliders.length, total: frequencies.length });
  } else {
    showEqualizerDebug('Успешно создано {count} полос эквалайзера ✓', false, { count: createdSliders.length });
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

  // Чекбоксы включения эквалайзера и выравнивания громкости
  const eqEnableChk = document.getElementById('eqEnableChk');
  const normEnableChk = document.getElementById('normEnableChk');
  if (eqEnableChk) {
    eqEnableChk.checked = !!state.settings.equalizer?.enabled;
    eqEnableChk.onchange = () => {
      if (!state.settings.equalizer) {
        state.settings.equalizer = { enabled: true, values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preset: 'normal' };
      }
      state.settings.equalizer.enabled = eqEnableChk.checked;
      saveData();
      applyAudioProcessingChange();
    };
  }
  if (normEnableChk) {
    normEnableChk.checked = !state.settings.normalization || state.settings.normalization.enabled !== false;
    normEnableChk.onchange = () => {
      if (!state.settings.normalization) state.settings.normalization = { enabled: true };
      state.settings.normalization.enabled = normEnableChk.checked;
      saveData();
      applyAudioProcessingChange();
    };
  }
}

// Применить изменение вкл/выкл обработки звука на лету: если элемент уже в графе —
// просто переключаем блоки; если обработку включили на потоке, идущем в обход
// Web Audio — перезапускаем текущую станцию уже с обработкой
function applyAudioProcessingChange() {
  const eqWanted = !!(state.settings.equalizer && state.settings.equalizer.enabled && window.Equalizer);
  const normWanted = !!(state.settings.normalization && state.settings.normalization.enabled !== false && window.Equalizer);
  const wanted = eqWanted || normWanted;

  if (!state.audio) return;

  if (state.equalizer && state.equalizer.isAttachedTo(state.audio)) {
    state.equalizer.configure({ useEqualizer: eqWanted, useNormalization: normWanted });
    return;
  }

  if (wanted && state.isPlaying && state.currentStation) {
    // Поток уже известен как «без CORS» — перезапуск не поможет
    if (state.streamsWithoutWebAudio.has(state.currentStation.url)) {
      showToast(t('Для этой станции обработка звука недоступна:\nсервер не отдаёт CORS-заголовки.'), 'info');
      return;
    }
    // Быстро гасим текущий элемент и перезапускаем станцию через playStation
    const oldAudio = state.audio;
    state.isPlaying = false;
    state.isSwitching = false;
    fadeOutVolume(oldAudio, 300, () => {
      try {
        oldAudio.pause();
        oldAudio.src = '';
        oldAudio.load();
      } catch (e) {
        // Игнорируем ошибки очистки элемента
      }
      if (state.equalizer) state.equalizer.releaseSources(0);
      if (state.audio === oldAudio) state.audio = null;
      if (state.currentStation) {
        playStation(state.currentStation).catch(err => console.error('Ошибка перезапуска станции:', err));
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
    messageEl.textContent = t('Ошибка: заполните все поля');
    messageEl.className = 'message error';
    return;
  }
  
  // Проверить валидность URL
  try {
    new URL(url);
  } catch (e) {
    messageEl.textContent = t('Ошибка: неверный URL');
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
    messageEl.textContent = t('Станция успешно добавлена!');
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
    messageEl.textContent = t('Ошибка при сохранении станции: {error}', { error: error.message });
    messageEl.className = 'message error';
  }
}

// Редактирование станции
function editStation(stationId) {
  const station = state.stations.find(s => s.id === stationId);
  
  if (!station) {
    showToast(t('Станция не найдена'), 'error');
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
  
  // Открыть панель «Станции» в настройках и прокрутить к форме
  setTimeout(() => {
    const panel = document.getElementById('stations-management');
    if (panel) {
      // Открыть панель «Станции» (вместо старого аккордеона)
      if (typeof window.toggleAccordion === 'function') {
        window.toggleAccordion('stations-management');
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
/**
 * Импорт YouTube-плейлиста по ссылке в станции.
 * Хост один раз разбирает ссылку (список треков + обложка), треки кладутся
 * в станцию целиком — сами аудио-потоки резолвятся только перед запуском.
 */
async function addYoutubePlaylist() {
  const input = document.getElementById('ytPlaylistUrl');
  const button = document.getElementById('addYtPlaylistBtn');
  const messageEl = document.getElementById('ytPlaylistMessage');
  const url = (input?.value || '').trim();

  if (!url) {
    if (messageEl) {
      messageEl.textContent = t('Вставьте ссылку на плейлист YouTube');
      messageEl.className = 'message error';
    }
    return;
  }

  if (button) button.disabled = true;
  if (messageEl) {
    messageEl.textContent = t('Загружаем плейлист…');
    messageEl.className = 'message';
  }

  try {
    const result = await window.AppAPI.resolveYoutubePlaylist(url);
    const tracks = Array.isArray(result?.tracks) ? result.tracks : [];

    if (!result?.success || !tracks.length) {
      if (messageEl) {
        messageEl.textContent = result?.success
          ? t('Плейлист пуст')
          : t('Не удалось загрузить плейлист: {error}', { error: result?.error || t('Неизвестная ошибка') });
        messageEl.className = 'message error';
      }
      return;
    }

    const station = {
      id: 'yt-' + Date.now(),
      name: result.title || t('YouTube-плейлист'),
      url,
      country: 'OTHER',
      genre: 'YouTube',
      source: 'YouTube',
      type: 'youtube-playlist',
      image: result.thumbnail || '',
      ytTracks: tracks
    };

    state.stations.push(station);
    await window.AppAPI.saveStations(state.stations);
    renderStations(state.stations);
    renderFavorites();

    const success = t('Плейлист добавлен: {n} треков', { n: tracks.length });
    if (input) input.value = '';
    if (messageEl) {
      messageEl.textContent = success;
      messageEl.className = 'message success';
    }
    showToast(success, 'success');
  } catch (error) {
    if (messageEl) {
      messageEl.textContent = t('Не удалось загрузить плейлист: {error}', { error: error.message });
      messageEl.className = 'message error';
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function updateStation(stationId) {
  const name = document.getElementById('stationName').value.trim();
  const url = document.getElementById('stationUrl').value.trim();
  const country = document.getElementById('stationCountry').value;
  const genre = document.getElementById('stationGenre').value;
  const messageEl = document.getElementById('addStationMessage');
  
  if (!name || !url) {
    messageEl.textContent = t('Ошибка: заполните все поля');
    messageEl.className = 'message error';
    return;
  }
  
  // Проверить валидность URL
  try {
    new URL(url);
  } catch (e) {
    messageEl.textContent = t('Ошибка: неверный URL');
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
    
    messageEl.textContent = t('Станция успешно обновлена и сохранена!');
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
    messageEl.textContent = t('Ошибка при сохранении станции: {error}', { error: error.message });
    messageEl.className = 'message error';
  }
}

// Удаление станции
async function deleteStation(stationId) {
  // Подтверждение удаления
  if (!confirm(t('Вы уверены, что хотите удалить эту станцию?'))) {
    return;
  }
  
  // Найти и удалить станцию из массива
  const stationIndex = state.stations.findIndex(s => s.id === stationId);
  
  if (stationIndex === -1) {
    showToast(t('Станция не найдена'), 'error');
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
    showToast(t('Ошибка при удалении станции: {error}', { error: error.message }), 'error');
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
  messageEl.textContent = t('Настройки сохранены!');
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
  // Мост с хостом устроен как «запрос/ответ» (у каждого вызова есть
  // callbackId): событий от C# в страницу не приходит, поэтому on* у AppAPI
  // может и не оказаться. Раньше эти вызовы падали с TypeError и обрывали
  // init() дальше — вместе с ними не работали переводы, проверка обновлений,
  // автозапуск последней станции и периодическая проверка станций.
  const register = (name, handler) => {
    if (typeof window.AppAPI?.[name] === 'function') {
      window.AppAPI[name](handler);
    }
  };

  register('onTogglePlay', () => {
    togglePlay();
  });
  
  register('onStopPlay', () => {
    stopPlay();
  });

  // YouTube-очередь: хост сообщает событием nativeEnded, что трек доиграл
  // до конца, — двигаем очередь к следующему. nativeError — поток умер
  // посреди игры, очередь пропускает трек по общим правилам.
  register('onNativeEnded', handleNativeEnded);
  register('onNativeError', handleNativeError);
  // Перемотка YouTube: позиция и длительность трека для полосы прогресса.
  register('onNativeTime', handleNativeTime);
  
  register('onStopAllAudio', () => {
    stopAllAudio();
  });
  
  register('onShowAbout', () => {
    showToast(t('CatLu Radio NET v3.5.4\n\nПриложение для прослушивания интернет-радио.'), 'info');
  });
  
  // При выгрузке страницы помечаем закрытие: stopPlay() в этом случае не
  // стирает последнюю станцию — она нужна для автозапуска при следующем запуске.
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
      showToast(t('Станции успешно экспортированы в файл:\n{path}', { path: result.path }), 'success');
    } else if (!result.canceled) {
      showToast(t('Ошибка экспорта: {error}', { error: result.error || t('Неизвестная ошибка') }), 'error');
    }
  } catch (error) {
    console.error('Export error:', error);
    showToast(t('Ошибка при экспорте станций'), 'error');
  }
}

// Импорт станций
async function importStations() {
  try {
    const result = await window.AppAPI.importStations();
    
    if (result.success) {
      let message = t('Импортировано станций: {imported}\nВсего станций: {total}', { imported: result.imported, total: result.total });
      if (result.skipped && result.skipped > 0) {
        message += '\n' + t('Пропущено дубликатов: {skipped}', { skipped: result.skipped });
      }
      showToast(message, 'success');
      // Перезагрузить данные и обновить список
      await loadData();
      loadStations();
    } else if (!result.canceled) {
      showToast(t('Ошибка импорта: {error}', { error: result.error || t('Неизвестная ошибка') }), 'error');
    }
  } catch (error) {
    console.error('Import error:', error);
    showToast(t('Ошибка при импорте станций. Проверьте формат файла.'), 'error');
  }
}

// Извлечение потока из TuneIn
async function extractTuneInStream() {
  const urlInput = document.getElementById('stationUrl');
  const messageEl = document.getElementById('addStationMessage');
  const tuneInUrl = urlInput.value.trim();
  
  if (!tuneInUrl) {
    messageEl.textContent = t('Введите URL TuneIn или iframe код');
    messageEl.className = 'message error';
    return;
  }
  
  messageEl.textContent = t('Извлечение потока из TuneIn...');
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
      
      messageEl.textContent = t('Поток успешно извлечен из TuneIn!');
      messageEl.className = 'message success';
      
      setTimeout(() => {
        messageEl.textContent = '';
        messageEl.className = 'message';
      }, 3000);
    } else {
      messageEl.textContent = result.error || t('Не удалось извлечь поток. Возможно, станция недоступна или требует авторизации.');
      messageEl.className = 'message error';
    }
  } catch (error) {
    console.error('Ошибка извлечения потока:', error);
    messageEl.textContent = t('Ошибка при извлечении потока: {error}', { error: error.message });
    messageEl.className = 'message error';
  }
}

// Извлечение потока из RadioPotok
async function extractRadioPotokStream() {
  const urlInput = document.getElementById('stationUrl');
  const messageEl = document.getElementById('addStationMessage');
  const radiopotokUrl = urlInput.value.trim();
  
  if (!radiopotokUrl) {
    messageEl.textContent = t('Введите URL скрипта RadioPotok (например: https://radiopotok.ru/f/script6.1/4.js)');
    messageEl.className = 'message error';
    return;
  }
  
  if (!radiopotokUrl.includes('radiopotok.ru')) {
    messageEl.textContent = t('URL должен содержать radiopotok.ru');
    messageEl.className = 'message error';
    return;
  }
  
  messageEl.textContent = t('Извлечение потока из RadioPotok...');
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
      
      messageEl.textContent = t('Поток успешно извлечен из RadioPotok!');
      messageEl.className = 'message success';
      
      setTimeout(() => {
        messageEl.textContent = '';
        messageEl.className = 'message';
      }, 3000);
    } else {
      messageEl.textContent = result.error || t('Не удалось извлечь поток. Возможно, станция недоступна или использует защищенный поток.');
      messageEl.className = 'message error';
    }
  } catch (error) {
    console.error('Ошибка извлечения потока:', error);
    messageEl.textContent = t('Ошибка при извлечении потока: {error}', { error: error.message });
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
      sleepTimerStatus.textContent = t('Остановка через: {time}', { time: `${minutes}:${seconds.toString().padStart(2, '0')}` });
      sleepTimerStatus.style.display = 'block';
      sleepTimerStatus.className = 'message';
    }
    
    if (remaining <= 0) {
      stopSleepTimer();
      stopPlay();
      if (sleepTimerStatus) {
        sleepTimerStatus.textContent = t('Таймер сработал. Воспроизведение остановлено.');
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
    container.innerHTML = `<p style="color: var(--md-on-surface-variant); margin: 10px 0;">${t('Нет расписаний. Добавьте новое расписание.')}</p>`;
    return;
  }
  
  container.innerHTML = state.settings.scheduler.schedules.map((schedule, index) => {
    const station = state.stations.find(s => s.id === schedule.stationId);
    const stationName = station ? station.name : t('Станция {id}', { id: schedule.stationId });
    const daysNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'].map(d => t(d));
    const daysStr = schedule.days && schedule.days.length > 0 
      ? schedule.days.map(d => daysNames[d]).join(', ')
      : t('Каждый день');
    
    return `
      <div class="schedule-item" style="border: 1px solid var(--md-outline-variant); border-radius: 8px; padding: 12px; margin-bottom: 10px; background: var(--md-surface-container-low);">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <div style="font-weight: 500; margin-bottom: 5px;">${escapeHtml(stationName)}</div>
            <div style="font-size: 0.9em; color: var(--md-on-surface-variant);">
              ${t('Время: {time} | Дни: {days}', { time: escapeHtml(schedule.time), days: escapeHtml(daysStr) })}
            </div>
            <div style="font-size: 0.85em; color: var(--md-on-surface-variant); margin-top: 5px;">
              ${t('Статус: {status}', { status: schedule.enabled ? t('✅ Включено') : t('❌ Выключено') })}
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
  if (!state.settings.scheduler?.schedules?.[index] || !confirm(t('Удалить это расписание?'))) return;
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
  stationSelect.innerHTML = `<option value="">${t('Выберите станцию...')}</option>`;
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
      title.textContent = t('Редактировать расписание');
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
    title.textContent = t('Добавить расписание');
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
      messageEl.textContent = t('Выберите станцию');
      messageEl.className = 'message error';
      messageEl.style.display = 'block';
    }
    return;
  }
  
  if (!time) {
    if (messageEl) {
      messageEl.textContent = t('Введите время включения');
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
