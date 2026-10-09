// Модуль переводов интерфейса.
//
// Русский — источник: ключ словаря это сама русская строка из UI (как она
// записана в index.html/renderer.js). Переводы: en (полный), lt и he (основной
// интерфейс; недостающие ключи откатываются на английский). Язык выбирается
// автоматически по системе (navigator.language), если системного языка нет в
// списке — по умолчанию английский. Пользователь может выбрать язык вручную
// в настройках: 'auto' | 'ru' | 'en' | 'lt' | 'he'.
//
// API (renderer.js вызывает эти имена):
//   t(key, vars)        — перевести строку, {placeholders} берутся из vars;
//   localize(value)     — перевести готовый текст (иначе вернуть как есть);
//   setLanguage(mode)   — сохранить режим и применить переводы;
//   applyTranslations() — заново пройтись по DOM (alias applyAll);
//   onApplied           — колбэк renderer после смены языка (перерисовка).
const TranslationManager = {
  // Режим из настроек: 'auto' | 'ru' | 'en' | 'lt' | 'he'
  mode: 'auto',
  // Фактический язык после resolve()
  lang: 'en',
  // Колбэк после применения переводов (назначает renderer)
  onApplied: null,
  // Обратный индекс: переведённое значение -> русский ключ
  reverse: null,

  dict: {
    en: {
      // ——— Шапка, вкладки ———
      'Станции': 'Stations',
      'Поиск': 'Search',
      'Избранное': 'Favorites',
      'История': 'History',
      'Эквалайзер': 'Equalizer',
      'Настройки': 'Settings',
      'Закрыть настройки': 'Close settings',
      'Мини-плеер': 'Mini player',
      'Развернуть': 'Expand',
      'Выход': 'Exit',
      'Воспроизвести/Пауза': 'Play/Pause',
      'Остановить': 'Stop',
      'Выход из приложения': 'Exit application',
      'Сейчас играет:': 'Now playing:',
      'Сейчас играет': 'Now playing',
      'Проверить станции': 'Check stations',
      'Перемотать назад на 10 секунд': 'Rewind 10 seconds',
      'Перемотать вперёд на 10 секунд': 'Forward 10 seconds',
      'Позиция трека': 'Track position',
      'Предыдущий трек': 'Previous track',
      'Следующий трек': 'Next track',

      // ——— Поиск станций ———
      'Все порталы': 'All portals',
      'Портал': 'Portal',
      'Страна': 'Country',
      'Название, стиль, исполнитель или годы': 'Name, genre, artist or years',
      'Все страны': 'All countries',
      'Найти в интернете': 'Search the internet',
      '🌐 Найти': '🌐 Search',
      'Очистить': 'Clear',
      'К станциям': 'Back to stations',
      'Поиск станций...': 'Search stations...',
      'По алфавиту': 'A to Z',
      'По жанру': 'By genre',
      'По стране': 'By country',
      'Прослушать': 'Play',
      'Добавить в плейлист': 'Add to playlist',
      'Уже в плейлисте': 'Already in playlist',
      'Введите название, стиль, исполнителя, годы или выберите страну.': 'Enter a name, genre, artist, years or pick a country.',
      'Поиск…': 'Searching…',
      'Работающие станции не найдены.': 'No working stations found.',
      'Станции не найдены': 'No stations found',

      // ——— Избранное и история ———
      'Нет избранных станций. Добавьте станции в избранное из списка станций.': 'No favorite stations yet. Add favorites from the station list.',
      'История прослушанных станций': 'Listening history',
      'Очистить историю': 'Clear history',
      'История пуста. Начните прослушивать станции, и они появятся здесь.': 'History is empty. Start listening to stations and they will appear here.',
      'Вы уверены, что хотите очистить историю прослушанных станций?': 'Are you sure you want to clear your listening history?',

      // ——— Карточки станций и плеер ———
      'Редактировать': 'Edit',
      'Удалить': 'Delete',
      'Закрыть уведомление': 'Close notification',
      'Пауза': 'Pause',
      'Воспроизвести': 'Play',
      'Радиостанция': 'Radio station',
      'Интернет-радио': 'Internet radio',

      // ——— Эквалайзер ———
      'Предустановка:': 'Preset:',
      'Обычный': 'Normal',
      'Поп': 'Pop',
      'Рок': 'Rock',
      'Джаз': 'Jazz',
      'Классика': 'Classical',
      'Басы': 'Bass',
      'Высокие': 'Treble',
      'Вокал': 'Vocal',
      'Сброс': 'Reset',
      'Выравнивание громкости': 'Loudness leveling',
      'Перетащите ползунки для настройки частот. Изменения применяются автоматически.': 'Drag the sliders to adjust frequencies. Changes apply automatically.',
      'Ошибка создания эквалайзера. Слайдеры не были созданы.': 'Failed to create the equalizer. The sliders were not built.',
      'ОШИБКА: Модуль Equalizer не загружен. Проверьте загрузку modules/Equalizer.js': 'ERROR: Equalizer module not loaded. Check that modules/Equalizer.js is loaded',
      'ОШИБКА: Модуль Equalizer не найден после повторной попытки': 'ERROR: Equalizer module not found after retry',
      'ОШИБКА: Элемент equalizerBands не найден в DOM': 'ERROR: equalizerBands element not found in DOM',
      'ОШИБКА: Элемент equalizerBands не найден после повторной попытки': 'ERROR: equalizerBands element not found after retry',
      'ОШИБКА: Не удалось получить частоты эквалайзера': 'ERROR: Could not read equalizer frequencies',
      'ОШИБКА: Слайдеры не были созданы! Проверьте код создания элементов.': 'ERROR: Sliders were not created! Check the slider creation code.',
      'ВНИМАНИЕ: Создано {created} слайдеров из {total}': 'WARNING: Created {created} of {total} sliders',
      'Успешно создано {count} полос эквалайзера ✓': 'Successfully created {count} equalizer bands ✓',

      // ——— Настройки: навигация и основные ———
      '⚙️ Основные': '⚙️ General',
      '📻 Станции': '📻 Stations',
      '⏰ Автоматизация': '⏰ Automation',
      '🔧 Система': '🔧 System',
      'Язык интерфейса:': 'Interface language:',
      'Авто (системный)': 'Auto (system)',
      'Тема оформления:': 'Theme:',
      'Светлая': 'Light',
      'Темная': 'Dark',
      'Системная': 'System',
      'Сворачивать в трей при закрытии окна': 'Minimize to tray when closing the window',
      'Запускать свернутым': 'Start minimized',
      'Режим редактирования (позволяет редактировать все станции, включая предустановленные)': 'Edit mode (allows editing all stations, including built-in ones)',
      'Сохранить настройки': 'Save settings',
      'Настройки сохранены!': 'Settings saved!',

      // ——— Настройки: управление станциями ———
      'Добавить станцию': 'Add station',

      // ——— Настройки: YouTube-плейлист ———
      'YouTube-плейлист': 'YouTube playlist',
      'Добавьте плейлист, видео или YouTube-радио по ссылке — он заиграет очередью в основном плеере, с эквалайзером и историей.': 'Add a playlist, video or YouTube radio by link — it will play as a queue in the main player, with the equalizer and history.',
      '➕ Добавить плейлист': '➕ Add playlist',
      'Плейлист пуст': 'Playlist is empty',
      'Вставьте ссылку на плейлист YouTube': 'Paste a YouTube playlist link',
      'Загружаем плейлист…': 'Loading playlist…',
      'Не удалось загрузить плейлист: {error}': 'Failed to load playlist: {error}',
      'Плейлист добавлен: {n} треков': 'Playlist added: {n} tracks',
      'LibVLC не начал воспроизведение': 'LibVLC did not start playback',
      'Не удалось воспроизвести плейлист: {name}': 'Failed to play playlist: {name}',
      'Название станции:': 'Station name:',
      'Например: Моя Радиостанция': 'e.g. My Radio Station',
      'URL потока:': 'Stream URL:',
      'https://example.com/stream.mp3 или TuneIn URL или RadioPotok скрипт': 'https://example.com/stream.mp3, a TuneIn URL or a RadioPotok script',
      'Извлечь поток из TuneIn': 'Extract stream from TuneIn',
      'Извлечь поток из RadioPotok (введите ссылку на скрипт: https://radiopotok.ru/f/script6.1/4.js)': 'Extract stream from RadioPotok (enter the script link: https://radiopotok.ru/f/script6.1/4.js)',
      'Страна:': 'Country:',
      'Жанр:': 'Genre:',
      'Описание (необязательно):': 'Description (optional):',
      'Краткое описание станции': 'Short station description',
      '💾 Сохранить изменения': '💾 Save changes',
      '❌ Отмена': '❌ Cancel',
      'Импорт/Экспорт станций': 'Import/Export stations',
      'Экспортируйте все ваши станции в JSON файл или импортируйте станции из файла расширения браузера.': 'Export all your stations to a JSON file or import stations from a browser extension file.',
      '📥 Экспорт станций': '📥 Export stations',
      '📤 Импорт станций': '📤 Import stations',
      '🔄 Загрузить предустановленные станции': '🔄 Load built-in stations',
      'Ошибка: заполните все поля': 'Error: fill in all required fields',
      'Станция успешно добавлена!': 'Station added successfully!',

      // ——— Настройки: автоматизация ———
      'Таймер сна': 'Sleep timer',
      'Автоматически остановить воспроизведение через указанное время.': 'Automatically stop playback after the chosen time.',
      'Включить таймер сна': 'Enable sleep timer',
      'Время до остановки (минуты):': 'Time until stop (minutes):',
      'Запустить таймер': 'Start timer',
      'Остановить таймер': 'Stop timer',
      'Остановка через: {time}': 'Stopping in: {time}',
      'Таймер сработал. Воспроизведение остановлено.': 'Timer elapsed. Playback stopped.',
      'Планировщик': 'Scheduler',
      'Запланировать автоматическое включение станций по расписанию.': 'Schedule stations to start automatically.',
      'Включить планировщик': 'Enable scheduler',
      '➕ Добавить расписание': '➕ Add schedule',
      'Нет расписаний. Добавьте новое расписание.': 'No schedules yet. Add a new schedule.',
      'Станция {id}': 'Station {id}',
      'Каждый день': 'Every day',
      'Время: {time} | Дни: {days}': 'Time: {time} | Days: {days}',
      'Статус: {status}': 'Status: {status}',
      '✅ Включено': '✅ On',
      '❌ Выключено': '❌ Off',
      'Удалить это расписание?': 'Delete this schedule?',

      // ——— Настройки: система ———
      'Плеер интернет-радио с поиском, избранным, историей и эквалайзером.': 'Internet radio player with search, favorites, history and an equalizer.',
      'GitHub и обновления': 'GitHub and updates',
      'Обновления': 'Updates',
      'Проверка обновлений при запуске.': 'Checks for updates on startup.',
      'Проверить обновления': 'Check for updates',
      'Закрыть приложение и выйти.': 'Close the app and quit.',
      '🚪 Выход из приложения': '🚪 Exit application',
      'Вы уверены, что хотите закрыть приложение?': 'Are you sure you want to close the application?',

      // ——— Модальное окно расписания ———
      'Добавить расписание': 'Add schedule',
      'Редактировать расписание': 'Edit schedule',
      'Станция:': 'Station:',
      'Выберите станцию...': 'Select a station...',
      'Время включения (HH:MM):': 'Start time (HH:MM):',
      'Дни недели:': 'Days of the week:',
      'Вс': 'Su',
      'Пн': 'Mo',
      'Вт': 'Tu',
      'Ср': 'We',
      'Чт': 'Th',
      'Пт': 'Fr',
      'Сб': 'Sa',
      'Если не выбрано ни одного дня, расписание будет работать каждый день': 'If no days are selected, the schedule will run every day',
      'Сохранить': 'Save',
      'Отмена': 'Cancel',
      'Выберите станцию': 'Select a station',
      'Введите время включения': 'Enter the start time',

      // ——— Воспроизведение и ошибки ———
      'Ошибка: не указан URL станции': 'Error: station URL is missing',
      'Ошибка: неверный формат URL станции': 'Error: invalid station URL format',
      'Станция играет без обработки звука:\nсервер не поддерживает режим CORS.': 'Playing without sound processing:\nthe server does not support CORS.',
      'Для этой станции обработка звука недоступна:\nсервер не отдаёт CORS-заголовки.': 'Sound processing is unavailable for this station:\nthe server sends no CORS headers.',
      'Проблема с сетью. Проверьте подключение к интернету.': 'Network problem. Check your internet connection.',
      'Ошибка декодирования аудио. Возможно, формат не поддерживается.': 'Audio decoding error. The format may not be supported.',
      'Поток не удалось открыть или его формат не поддерживается.': 'The stream could not be opened or its format is not supported.',
      'Код ошибки: {code}': 'Error code: {code}',
      'Рабочий резервный поток не найден.': 'No working backup stream found.',
      'Ошибка загрузки станции: {name}': 'Failed to load station: {name}',
      'Ошибка воспроизведения: {name}\nПроверьте URL потока.': 'Playback error: {name}\nCheck the stream URL.',
      'Ошибка воспроизведения: {name}\nПоток не загружается.': 'Playback error: {name}\nThe stream does not load.',
      'Ошибка воспроизведения: {name}\n{message}': 'Playback error: {name}\n{message}',
      'Автозапуск ждёт нажатия: {name}\nНажмите в окне — станция продолжит.': 'Autostart is waiting for a click: {name}\nClick anywhere — the station will continue.',
      'Ошибка воспроизведения HLS потока: {name}': 'HLS playback error: {name}',
      'Ошибка загрузки HLS потока: {name}\nФормат аудио не поддерживается.\n\nURL: {url}': 'HLS load error: {name}\nAudio format is not supported.\n\nURL: {url}',
      'HLS потоки (m3u8) не поддерживаются в этом браузере.\n\nПопробуйте использовать другой поток или обновить браузер.': 'HLS streams (m3u8) are not supported in this browser.\n\nTry another stream or update the browser.',
      'Ошибка при загрузке станции: {name}': 'Error loading station: {name}',
      'Ошибка: не выбрана станция для редактирования': 'Error: no station selected for editing',
      'Ошибка: неверный URL': 'Error: invalid URL',
      'Ошибка при сохранении станции: {error}': 'Error saving station: {error}',
      'Станция не найдена': 'Station not found',
      'Станция успешно обновлена и сохранена!': 'Station updated and saved successfully!',
      'Вы уверены, что хотите удалить эту станцию?': 'Are you sure you want to delete this station?',
      'Ошибка при удалении станции: {error}': 'Error deleting station: {error}',
      'CatLu Radio NET v3.5.6\n\nПриложение для прослушивания интернет-радио.': 'CatLu Radio NET v3.5.6\n\nInternet radio player.',

      // ——— Проверка станций и обновления ———
      'Проверка…': 'Checking…',
      'Работают {working} из {total}': '{working} of {total} working',
      'Проверка обновлений…': 'Checking for updates…',
      'Не удалось проверить обновления.': 'Could not check for updates.',
      'Установлена последняя версия.': 'You are running the latest version.',
      'Доступна версия {version}.': 'Version {version} is available.',
      'Обновить до {version}': 'Update to {version}',
      'Скачать и установить версию {version}?': 'Download and install version {version}?',
      'Скачивание установщика…': 'Downloading the installer…',
      'Не удалось запустить обновление.': 'Could not start the update.',

      // ——— Экспорт / импорт ———
      'Станции успешно экспортированы в файл:\n{path}': 'Stations exported to file:\n{path}',
      'Ошибка экспорта: {error}': 'Export error: {error}',
      'Неизвестная ошибка': 'Unknown error',
      'Ошибка при экспорте станций': 'Error exporting stations',
      'Импортировано станций: {imported}\nВсего станций: {total}': 'Stations imported: {imported}\nTotal stations: {total}',
      'Пропущено дубликатов: {skipped}': 'Duplicates skipped: {skipped}',
      'Ошибка импорта: {error}': 'Import error: {error}',
      'Ошибка при импорте станций. Проверьте формат файла.': 'Error importing stations. Check the file format.',

      // ——— TuneIn / RadioPotok ———
      'Введите URL TuneIn или iframe код': 'Enter a TuneIn URL or iframe code',
      'Извлечение потока из TuneIn...': 'Extracting stream from TuneIn...',
      'Поток успешно извлечен из TuneIn!': 'Stream extracted from TuneIn successfully!',
      'Не удалось извлечь поток. Возможно, станция недоступна или требует авторизации.': 'Could not extract the stream. The station may be unavailable or require authorization.',
      'Ошибка при извлечении потока: {error}': 'Error extracting the stream: {error}',
      'Введите URL скрипта RadioPotok (например: https://radiopotok.ru/f/script6.1/4.js)': 'Enter the RadioPotok script URL (e.g. https://radiopotok.ru/f/script6.1/4.js)',
      'URL должен содержать radiopotok.ru': 'The URL must contain radiopotok.ru',
      'Извлечение потока из RadioPotok...': 'Extracting stream from RadioPotok...',
      'Поток успешно извлечен из RadioPotok!': 'Stream extracted from RadioPotok successfully!',
      'Не удалось извлечь поток. Возможно, станция недоступна или использует защищенный поток.': 'Could not extract the stream. The station may be unavailable or use a protected stream.',

      // ——— Страны (справочник и списки) ———
      'СНГ': 'CIS',
      'Европа': 'Europe',
      'Россия': 'Russia',
      'Армения': 'Armenia',
      'Азербайджан': 'Azerbaijan',
      'Беларусь': 'Belarus',
      'Казахстан': 'Kazakhstan',
      'Кыргызстан': 'Kyrgyzstan',
      'Молдова': 'Moldova',
      'Таджикистан': 'Tajikistan',
      'Туркменистан': 'Turkmenistan',
      'Узбекистан': 'Uzbekistan',
      'Албания': 'Albania',
      'Австрия': 'Austria',
      'Бельгия': 'Belgium',
      'Болгария': 'Bulgaria',
      'Босния и Герцеговина': 'Bosnia and Herzegovina',
      'Великобритания': 'United Kingdom',
      'Венгрия': 'Hungary',
      'Германия': 'Germany',
      'Греция': 'Greece',
      'Дания': 'Denmark',
      'Ирландия': 'Ireland',
      'Исландия': 'Iceland',
      'Испания': 'Spain',
      'Италия': 'Italy',
      'Кипр': 'Cyprus',
      'Латвия': 'Latvia',
      'Литва': 'Lithuania',
      'Люксембург': 'Luxembourg',
      'Мальта': 'Malta',
      'Нидерланды': 'Netherlands',
      'Норвегия': 'Norway',
      'Польша': 'Poland',
      'Португалия': 'Portugal',
      'Румыния': 'Romania',
      'Сербия': 'Serbia',
      'Словакия': 'Slovakia',
      'Словения': 'Slovenia',
      'Финляндия': 'Finland',
      'Франция': 'France',
      'Хорватия': 'Croatia',
      'Черногория': 'Montenegro',
      'Чехия': 'Czech Republic',
      'Швейцария': 'Switzerland',
      'Швеция': 'Sweden',
      'Эстония': 'Estonia',
      'Украина': 'Ukraine',
      'Грузия': 'Georgia',
      'Турция': 'Turkey',
      'США': 'USA',
      'Израиль': 'Israel',
      'Другая': 'Other'
    },

    lt: {
      'Станции': 'Stacijos',
      'Поиск': 'Paieška',
      'Избранное': 'Mėgstamiausios',
      'История': 'Istorija',
      'Эквалайзер': 'Ekvalaizeris',
      'Настройки': 'Nustatymai',
      'Закрыть настройки': 'Uždaryti nustatymus',
      'Мини-плеер': 'Mini grotuvas',
      'Развернуть': 'Išskleisti',
      'Выход': 'Išeiti',
      'Воспроизвести/Пауза': 'Groti / Pauzė',
      'Остановить': 'Sustabdyti',
      'Выход из приложения': 'Išeiti iš programos',
      'Сейчас играет:': 'Dabar groja:',
      'Сейчас играет': 'Dabar groja',
      'Проверить станции': 'Tikrinti stotis',
      'Перемотать назад на 10 секунд': 'Atsukti 10 sekundžių atgal',
      'Перемотать вперёд на 10 секунд': 'Pirmyn 10 sekundžių',
      'Позиция трека': 'Takelio pozicija',
      'Предыдущий трек': 'Ankstesnis takelis',
      'Следующий трек': 'Kitas takelis',

      'Все порталы': 'Visi portalai',
      'Портал': 'Portalas',
      'Страна': 'Šalis',
      'Название, стиль, исполнитель или годы': 'Pavadinimas, stilius, atlikėjas arba metai',
      'Все страны': 'Visos šalys',
      'Найти в интернете': 'Ieškoti internete',
      '🌐 Найти': '🌐 Ieškoti',
      'Очистить': 'Išvalyti',
      'К станциям': 'Atgal į stotis',
      'По алфавиту': 'Pagal abėcėlę',
      'По жанру': 'Pagal žanrą',
      'По стране': 'Pagal šalį',
      'Прослушать': 'Klausytis',
      'Добавить в плейлист': 'Pridėti į grojaraštį',
      'Уже в плейлисте': 'Jau grojaraštyje',
      'Введите название, стиль, исполнителя, годы или выберите страну.': 'Įveskite pavadinimą, stilių, atlikėją, metus arba pasirinkite šalį.',
      'Поиск…': 'Ieškoma…',
      'Работающие станции не найдены.': 'Veikiančios stotys nerastos.',
      'Станции не найдены': 'Stotys nerastos',

      'Нет избранных станций. Добавьте станции в избранное из списка станций.': 'Mėgstamiausių stočių nėra. Pridėkite stotis iš sąrašo.',
      'История прослушанных станций': 'Klausytų stočių istorija',
      'Очистить историю': 'Išvalyti istoriją',
      'История пуста. Начните прослушивать станции, и они появятся здесь.': 'Istorija tuščia. Pradėkite klausytis stočių — jos atsiras čia.',
      'Вы уверены, что хотите очистить историю прослушанных станций?': 'Ar tikrai išvalyti klausytų stočių istoriją?',

      'Редактировать': 'Redaguoti',
      'Удалить': 'Ištrinti',
      'Пауза': 'Pauzė',
      'Воспроизвести': 'Groti',

      'Предустановка:': 'Nustatymas:',
      'Обычный': 'Įprastas',
      'Рок': 'Rock',
      'Джаз': 'Džiazas',
      'Классика': 'Klasika',
      'Басы': 'Bosai',
      'Высокие': 'Aukšti dažniai',
      'Вокал': 'Vokalas',
      'Сброс': 'Atstatyti',
      'Выравнивание громкости': 'Garsumo išlyginimas',
      'Перетащите ползунки для настройки частот. Изменения применяются автоматически.': 'Vilkite slankiklius dažniams reguliuoti. Pakeitimai taikomi automatiškai.',

      '⚙️ Основные': '⚙️ Pagrindinės',
      '📻 Станции': '📻 Stotys',
      '⏰ Автоматизация': '⏰ Automatika',
      '🔧 Система': '🔧 Sistema',
      'Язык интерфейса:': 'Sąsajos kalba:',
      'Авто (системный)': 'Auto (sistemos)',
      'Тема оформления:': 'Tema:',
      'Светлая': 'Šviesi',
      'Темная': 'Tamsi',
      'Системная': 'Sistemos',
      'Сворачивать в трей при закрытии окна': 'Uždarant langą slėpti į sistemų dėklą',
      'Запускать свернутым': 'Paleisti sutrauktą',
      'Режим редактирования (позволяет редактировать все станции, включая предустановленные)': 'Redagavimo režimas (leidžia redaguoti visas stotis, įskaitant numatytas)',
      'Сохранить настройки': 'Išsaugoti nustatymus',
      'Настройки сохранены!': 'Nustatymai išsaugoti!',

      'Добавить станцию': 'Pridėti stotį',

      // ——— YouTube grojaraštis ———
      'YouTube-плейлист': 'YouTube grojaraštis',
      'Добавьте плейлист, видео или YouTube-радио по ссылке — он заиграет очередью в основном плеере, с эквалайзером и историей.': 'Įrašykite grojaraštį, vaizdo įrašą ar YouTube radiją pagal nuorodą — jis gros eilėje pagrindiniame grotuve, su ekvalaizeriu ir istorija.',
      '➕ Добавить плейлист': '➕ Pridėti grojaraštį',
      'Плейлист пуст': 'Grojaraštis tuščias',
      'Вставьте ссылку на плейлист YouTube': 'Įklijuokite YouTube grojaraščio nuorodą',
      'Загружаем плейлист…': 'Įkeliamas grojaraštis…',
      'Не удалось загрузить плейлист: {error}': 'Nepavyko įkelti grojaraščio: {error}',
      'Плейлист добавлен: {n} треков': 'Grojaraštis pridėtas: {n} takelio (-ių)',
      'LibVLC не начал воспроизведение': 'LibVLC nepradėjo leisti',
      'Не удалось воспроизвести плейлист: {name}': 'Nepavyko paleisti grojaraščio: {name}',
      'Неизвестная ошибка': 'Nežinoma klaida',
      'Название станции:': 'Stoties pavadinimas:',
      'Например: Моя Радиостанция': 'Pvz.: Mano radijo stotis',
      'URL потока:': 'Srauto URL:',
      'Страна:': 'Šalis:',
      'Жанр:': 'Žanras:',
      'Описание (необязательно):': 'Aprašymas (neprivaloma):',
      '💾 Сохранить изменения': '💾 Išsaugoti pakeitimus',
      '❌ Отмена': '❌ Atšaukti',
      'Импорт/Экспорт станций': 'Stočių importas / eksportas',
      '📥 Экспорт станций': '📥 Eksportuoti stotis',
      '📤 Импорт станций': '📤 Importuoti stotis',
      '🔄 Загрузить предустановленные станции': '🔄 Įkelti numatytas stotis',
      'Ошибка: заполните все поля': 'Klaida: užpildykite visus laukus',
      'Станция успешно добавлена!': 'Stotis sėkmingai pridėta!',

      'Таймер сна': 'Miego laikmatis',
      'Включить таймер сна': 'Įjungti miego laikmatį',
      'Время до остановки (минуты):': 'Laikas iki sustabdymo (minutės):',
      'Запустить таймер': 'Paleisti laikmatį',
      'Остановить таймер': 'Sustabdyti laikmatį',
      'Остановка через: {time}': 'Stabdymas po: {time}',
      'Таймер сработал. Воспроизведение остановлено.': 'Laikmatis baigėsi. Grojimas sustabdytas.',
      'Планировщик': 'Tvarkaraštis',
      'Включить планировщик': 'Įjungti tvarkaraštį',
      '➕ Добавить расписание': '➕ Pridėti tvarkaraštį',
      'Нет расписаний. Добавьте новое расписание.': 'Tvarkaraščių nėra. Pridėkite naują.',
      'Каждый день': 'Kiekvieną dieną',
      'Время: {time} | Дни: {days}': 'Laikas: {time} | Dienos: {days}',
      'Статус: {status}': 'Būsena: {status}',
      '✅ Включено': '✅ Įjungta',
      '❌ Выключено': '❌ Išjungta',
      'Удалить это расписание?': 'Ištrinti šį tvarkaraštį?',

      'GitHub и обновления': 'GitHub ir atnaujinimai',
      'Обновления': 'Atnaujinimai',
      'Проверить обновления': 'Tikrinti atnaujinimus',
      'Выход из приложения': 'Išeiti iš programos',
      '🚪 Выход из приложения': '🚪 Išeiti iš programos',
      'Вы уверены, что хотите закрыть приложение?': 'Ar tikrai norite uždaryti programą?',

      'Добавить расписание': 'Pridėti tvarkaraštį',
      'Редактировать расписание': 'Redaguoti tvarkaraštį',
      'Выберите станцию...': 'Pasirinkite stotį...',
      'Время включения (HH:MM):': 'Įjungimo laikas (HH:MM):',
      'Дни недели:': 'Savaitės dienos:',
      'Вс': 'Sek',
      'Пн': 'Pr',
      'Вт': 'An',
      'Ср': 'Tr',
      'Чт': 'Kt',
      'Пт': 'Pn',
      'Сб': 'Sk',
      'Сохранить': 'Išsaugoti',
      'Отмена': 'Atšaukti',
      'Выберите станцию': 'Pasirinkite stotį',
      'Введите время включения': 'Įveskite įjungimo laiką',

      'Ошибка: не указан URL станции': 'Klaida: nenurodytas stoties URL',
      'Ошибка: неверный формат URL станции': 'Klaida: neteisingas stoties URL formatas',
      'Проблема с сетью. Проверьте подключение к интернету.': 'Tinklo problema. Patikrinkite interneto ryšį.',
      'Код ошибки: {code}': 'Klaidos kodas: {code}',
      'Ошибка загрузки станции: {name}': 'Nepavyko įkelti stoties: {name}',
      'Ошибка при загрузке станции: {name}': 'Klaida įkeliant stotį: {name}',
      'Пауза': 'Pauzė',
      'Проверка…': 'Tikrinama…',
      'Работают {working} из {total}': 'Veikia {working} iš {total}',
      'Проверка обновлений…': 'Tikrinama dėl atnaujinimų…',
      'Не удалось проверить обновления.': 'Nepavyko patikrinti atnaujinimų.',
      'Установлена последняя версия.': 'Įdiegta naujausia versija.',
      'Доступна версия {version}.': 'Yra versija {version}.',
      'Обновить до {version}': 'Atnaujinti į {version}',
      'Станция не найдена': 'Stotis nerasta',
      'Ошибка: неверный URL': 'Klaida: neteisingas URL',
      'Ошибка при сохранении станции: {error}': 'Klaida išsaugojant stotį: {error}',
      'Станция успешно обновлена и сохранена!': 'Stotis sėkmingai atnaujinta ir išsaugota!',
      'Вы уверены, что хотите удалить эту станцию?': 'Ar tikrai ištrinti šią stotį?',
      'Ошибка при удалении станции: {error}': 'Klaida trinant stotį: {error}',

      'СНГ': 'CIS',
      'Европа': 'Europa',
      'Россия': 'Rusija',
      'Беларусь': 'Baltarusija',
      'Казахстан': 'Kazachstanas',
      'Украина': 'Ukraina',
      'Грузия': 'Gruzija',
      'Армения': 'Armėnija',
      'Азербайджан': 'Azerbaidžanas',
      'Узбекистан': 'Uzbekistanas',
      'Великобритания': 'Didžioji Britanija',
      'Германия': 'Vokietija',
      'Франция': 'Prancūzija',
      'Испания': 'Ispanija',
      'Италия': 'Italija',
      'Польша': 'Lenkija',
      'Латвия': 'Latvija',
      'Литва': 'Lietuva',
      'Эстония': 'Estija',
      'Финляндия': 'Suomija',
      'Швеция': 'Švedija',
      'Норвегия': 'Norvegija',
      'Дания': 'Danija',
      'Нидерланды': 'Olandija',
      'Турция': 'Turkija',
      'Израиль': 'Izraelis',
      'США': 'JAV',
      'Другая': 'Kita'
    },

    he: {
      'Станции': 'תחנות',
      'Поиск': 'חיפוש',
      'Избранное': 'מועדפים',
      'Исторיה': 'היסטוריה',
      'Эквалайзер': 'אקלאייזר',
      'Настройки': 'הגדרות',
      'Закрыть настройки': 'סגור הגדרות',
      'Мини-плеер': 'נגן ממוזער',
      'Развернуть': 'הרחיב',
      'Выход': 'יציאה',
      'Воспроизвести/Пауза': 'נגן / השהיה',
      'Остановить': 'עצור',
      'Выход из приложения': 'יציאה מהאפליקציה',
      'Сейчас играет:': 'מנגן עכשיו:',
      'Сейчас играет': 'מנגן עכשיו',
      'Проверить станции': 'בדיקת תחנות',
      'Перемотать назад на 10 секунд': 'אחורה 10 שניות',
      'Перемотать вперёд на 10 секунд': 'קדימה 10 שניות',
      'Позиция трека': 'מיקום הרצועה',
      'Предыдущий трек': 'הרצועה הקודמת',
      'Следующий трек': 'הרצועה הבאה',

      'Все порталים': 'כל הפורטלים',
      'Портал': 'פורטל',
      'Странה': 'מדינה',
      'Название, стиль, исполнитель или годы': 'שם, סגנון, מבצע או שנים',
      'Все страны': 'כל המדינות',
      'Найти в интернете': 'חפש באינטרנט',
      '🌐 Найти': '🌐 חפש',
      'Очистить': 'נקה',
      'К станциям': 'חזרה לתחנות',
      'Прослушать': 'האזן',
      'Добавить в плейлист': 'הוסף לרשימת נגינה',
      'Уже в плейлисте': 'כבר ברשימה',
      'Введите название, стиль, исполнителя, годы или выберите страну.': 'הזן שם, סגנון, מבצע, שנים או בחר מדינה.',
      'Поиск…': 'מחפש…',
      'Работающие станции не найдены.': 'לא נמצאו תחנות פעילות.',
      'Станции не найдены': 'לא נמצאו תחנות',

      'Нет избранных станций. Добавьте станции в избранное из списка станций.': 'אין תחנות מועדפות. הוסף תחנות מהרשימה.',
      'История прослушанных станций': 'היסטוריית תחנות',
      'Очистить историю': 'נקה היסטוריה',
      'История пуста. Начните прослушивать станции, и они появятся здесь.': 'ההיסטוריה ריקה. התחל להאזין לתחנות והן יופיעו כאן.',
      'Вы уверены, что хотите очистить историю прослушанных станций?': 'לנקות את היסטוריית ההאזנה?',

      'Редактировать': 'עריכה',
      'Удалить': 'מחיקה',
      'Пауза': 'השהיה',
      'Воспроизвести': 'נגן',

      'Предустановка:': 'הגדרה מובנית:',
      'Обычный': 'רגיל',
      'Джаз': 'ג׳אז',
      'Классика': 'קלאסי',
      'Басы': 'בסים',
      'Высокие': 'תדרים גבוהים',
      'Вокал': 'קולות',
      'Сброс': 'איפוס',
      'Выравнивание громкости': 'יישור עצמה',
      'Перетащите ползунки для настройки частот. Изменения применяются автоматически.': 'גררו את המחוונים לכוונון תדרים. השינויים מוחלים אוטומטית.',

      '⚙️ Основные': '⚙️ כללי',
      '📻 Станции': '📻 תחנות',
      '⏰ Автоматизация': '⏰ אוטומציה',
      '🔧 Системה': '🔧 מערכת',
      'Язык интерфейса:': 'שפת הממשק:',
      'Авто (системный)': 'אוטומטי (המערכת)',
      'Тема оформления:': 'ערכת נושא:',
      'Светлая': 'בהירה',
      'Темная': 'כהה',
      'Системная': 'של המערכת',
      'Сворачивать в трей при закрытии окна': 'למזער למגש בעת סגירת החלון',
      'Запускать свернутым': 'להפעיל ממוזער',
      'Режим редактирования (позволяет редактировать все станции, включая предустановленные)': 'מצב עריכה ( מאפשר לערוך את כל התחנות, כולל המובנות)',
      'Сохранить настройки': 'שמור הגדרות',
      'Настройки сохранены!': 'ההגדרות נשמרו!',

      'Добавить станцию': 'הוספת תחנה',

      // ——— YouTube: רשימת השמעה ———
      'YouTube-плейлист': 'רשימת השמעה ב-YouTube',
      'Добавьте плейлист, видео или YouTube-радио по ссылке — он заиграет очередью в основном плеере, с эквалайзером и историей.': 'הוסיפו רשימת השמעה, סרטון או רדיו מ-YouTube דרך קישור — הוא ינוגן בתור בתנגן הראשי, עם אקвал라이זר והיסטוריה.',
      '➕ Добавить плейлист': '➕ הוספת רשימת השמעה',
      'Плейлист пуст': 'רשימת ההשמעה ריקה',
      'Вставьте ссылку на плейлист YouTube': 'הדביקו קישור לרשימת השמעה ב-YouTube',
      'Загружаем плейлист…': 'טוענים רשימת השמעה…',
      'Не удалось загрузить плейлист: {error}': 'טעינת רשימת ההשמעה נכשלה: {error}',
      'Плейлист добавлен: {n} треков': 'רשימת ההשמעה נוספה: {n} רצועות',
      'LibVLC не начал воспроизведение': 'LibVLC לא התחיל נגינה',
      'Не удалось воспроизвести плейлист: {name}': 'הנגינה ברשימת ההשמעה נכשלה: {name}',
      'Неизвестная ошибка': 'שגיאה לא ידועה',
      'Название станции:': 'שם התחנה:',
      'Например: Моя Радиостанция': 'לדוגמה: הרדיו שלי',
      'URL потока:': 'כתובת הסטרימינג:',
      'Странה:': 'מדינה:',
      'Жанר:': 'ז׳אנר:',
      'Описание (необязательно):': 'תיאור (לא חובה):',
      '💾 Сохранить изменения': '💾 שמור שינויים',
      '❌ Отмена': '❌ ביטול',
      'Импорт/Экспорт станций': 'ייבוא / ייצוא תחנות',
      '📥 Экспорт станций': '📥 ייצוא תחנות',
      '📤 Импорт станций': '📤 ייבוא תחנות',
      '🔄 Загрузить предустановленные станции': '🔄 טען תחנות מובנות',
      'Ошибка: заполните все поля': 'שגיאה: מלא את כל השדות',
      'Станция успешно добавлена!': 'התחנה נוספה בהצלחה!',

      'Таймер сна': 'טיימר שינה',
      'Включить таймер сна': 'הפעל טיימר שינה',
      'Время до остановки (минуты):': 'זמן עד עצירה (דקות):',
      'Запустить таймер': 'הפעל טיימר',
      'Остановить таймер': 'עצור טיימר',
      'Остановка через: {time}': 'יעצור בעוד: {time}',
      'Таймер сработал. Воспроизведение остановлено.': 'הטיימר הסתיים. הנגינה הופסקה.',
      'Планировщик': 'מתזמן',
      'Включить планировщик': 'הפעל מתזמן',
      '➕ Добавить расписание': '➕ הוספת לוח זמנים',
      'Нет расписаний. Добавьте новое расписание.': 'אין לוחות זמנים. הוסף חדש.',
      'Каждый день': 'כל יום',
      'Время: {time} | Дни: {days}': 'שעה: {time} | ימים: {days}',
      'Статус: {status}': 'סטטוס: {status}',
      '✅ Включено': '✅ פועל',
      '❌ Выключено': '❌ כבוי',
      'Удалить это расписание?': 'למחוק לוח זמנים זה?',

      'GitHub и обновления': 'GitHub ועדכונים',
      'Обновления': 'עדכונים',
      'Проверить обновления': 'בדוק עדכונים',
      'Выход из приложения': 'יציאה מהאפליקציה',
      '🚪 Выход из приложения': '🚪 יציאה מהאפליקציה',
      'Вы уверены, что хотите закрыть приложение?': 'לסגור את האפליקציה?',

      'Добавить расписание': 'הוספת לוח זמנים',
      'Редактировать расписание': 'עריכת לוח זמנים',
      'Выберите станцию...': 'בחר תחנה...',
      'Время включения (HH:MM):': 'שעה הפעלה (HH:MM):',
      'Дни недели:': 'ימי השבוע:',
      'Вс': 'א׳',
      'Пн': 'ב׳',
      'Вт': 'ג׳',
      'Ср': 'ד׳',
      'Чт': 'ה׳',
      'Пт': 'ו׳',
      'Сб': 'ש׳',
      'Сохранить': 'שמירה',
      'Отмена': 'ביטול',
      'Выберите станцию': 'בחר תחנה',
      'Введите время включения': 'הזן שעת הפעלה',

      'Ошибка: не указан URL станции': 'שגיאה: לא הוזנה כתובת תחנה',
      'Ошибка: неверный формат URL станции': 'שגיאה: פורמט כתובת שגוי',
      'Проблема с сетью. Проверьте подключение к интернету.': 'בעיית רשת. בדוק את החיבור לאינטרנט.',
      'Код ошибки: {code}': 'קוד שגיאה: {code}',
      'Ошибка загрузки станции: {name}': 'טעינת התחנה נכשלה: {name}',
      'Ошибка при загрузке станции: {name}': 'שגיאה בטעינת התחנה: {name}',
      'Проверка…': 'בודק…',
      'Работают {working} из {total}': 'עובדים {working} מתוך {total}',
      'Проверка обновлений…': 'בודק עדכונים…',
      'Не удалось проверить обновления.': 'לא ניתן לבדוק עדכונים.',
      'Установлена последняя версия.': 'מותקנת הגרסה האחרונה.',
      'Доступна версия {version}.': 'זמינה גרסה {version}.',
      'Обновить до {version}': 'עדכן ל-{version}',
      'Станция не найдена': 'התחנה לא נמצאה',
      'Ошибка: неверный URL': 'שגיאה: כתובת שגויה',
      'Ошибка при сохранении станции: {error}': 'שגיאה בשמירת התחנה: {error}',
      'Станция успешно обновлена и сохранена!': 'התחנה עודכנה ונשמרה בהצלחה!',
      'Вы уверены, что хотите удалить эту станцию?': 'למחוק את התחנה הזו?',
      'Ошибка при удалении станции: {error}': 'שגיאה במחיקת התחנה: {error}',

      'Европа': 'אירופה',
      'Россия': 'רוסיה',
      'Украина': 'אוקראינה',
      'Беларусь': 'בלארוס',
      'Казахстан': 'קזחסטן',
      'Германия': 'גרמניה',
      'Франция': 'צרפת',
      'Испניה': 'ספרד',
      'Италия': 'איטליה',
      'Польша': 'פולין',
      'Литва': 'ליטא',
      'Латвיה': 'לטביה',
      'Эстонיה': 'אסטוניה',
      'Великобритания': 'בריטניה',
      'США': 'ארה״ב',
      'Израиль': 'ישראל',
      'Другая': 'אחרת'
    }
  },

  // Заполнение {placeholders} значениями из vars
  fill(template, vars) {
    if (!vars) return String(template);
    return String(template).replace(/\{(\w+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    ));
  },

  // Перевод строки по русскому ключу: текущий язык -> английский -> исходник
  t(key, vars) {
    if (key === null || key === undefined) return key;
    const k = String(key);
    let out = k;
    if (this.lang !== 'ru') {
      const table = this.dict[this.lang] || {};
      const en = this.dict.en;
      out = Object.prototype.hasOwnProperty.call(table, k)
        ? table[k]
        : (Object.prototype.hasOwnProperty.call(en, k) ? en[k] : k);
    }
    return this.fill(out, vars);
  },

  // Перевод готового текста. Русский текст переводится, уже переведённый —
  // пере-переводится на текущий язык (обратный индекс), остальное не трогаем.
  localize(value) {
    if (typeof value !== 'string' || !value) return value;
    if (this.lang === 'ru') return value; // режим ru — единственный, где перевод не нужен
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (/[А-Яа-яЁё]/.test(trimmed)) return this.t(trimmed);
    if (this.reverse) {
      const ru = this.reverse[trimmed];
      if (ru) return this.t(ru);
    }
    return value;
  },

  // Обратный индекс: переведённое значение -> русский ключ
  buildReverse() {
    const reverse = {};
    ['en', 'lt', 'he'].forEach((code) => {
      const table = this.dict[code];
      Object.keys(table).forEach((ru) => {
        const value = table[ru];
        if (value && !Object.prototype.hasOwnProperty.call(reverse, value)) {
          reverse[value] = ru;
        }
      });
    });
    this.reverse = reverse;
  },

  // Определение языка системы; если такого нет — английский по умолчанию
  detectSystem() {
    let list = [];
    try {
      list = (navigator.languages && navigator.languages.length)
        ? navigator.languages
        : [navigator.language];
    } catch (e) {
      list = [];
    }
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      if (!raw) continue;
      const code = String(raw).toLowerCase().split(/[-_]/)[0];
      if (code === 'iw') return 'he'; // устаревший код иврита в старых ОС
      if (code === 'ru' || code === 'en' || code === 'lt' || code === 'he') return code;
    }
    return 'en';
  },

  // Режим настроек -> фактический язык
  resolve() {
    const mode = this.mode;
    if (mode && mode !== 'auto' && (mode === 'ru' || this.dict[mode])) return mode;
    return this.detectSystem();
  },

  // Сохранение режима ('auto' | 'ru' | 'en' | 'lt' | 'he') и применение
  setLanguage(mode) {
    if (mode !== undefined && mode !== null && mode !== '') this.mode = mode;
    this.applyAll();
  },

  getLanguage() {
    return this.lang;
  },

  // Проход по DOM: текстовые узлы и служебные атрибуты.
  //
  // Для каждого узла запоминаем его русский исходник (он же ключ словаря).
  // Дальше перевод всегда считается от исходника: переключение в любую сторону
  // (ru<->en<->lt<->he) восстанавливает правильный текст. Латинский контент
  // (названия станций, жанры) не кэшируется и в режиме ru не трогается.
  applyDocument() {
    if (typeof document === 'undefined' || !document.body) return;
    if (!this.textOrigins) {
      this.textOrigins = new WeakMap(); // TextNode -> русский ключ
      this.attrOrigins = new WeakMap(); // Element -> { attr: русский ключ }
    }
    const ATTRS = ['placeholder', 'title', 'aria-label', 'label', 'alt'];
    const RU_RE = /[А-Яа-яЁё]/;
    const self = this;

    const visit = (el) => {
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;

      // --- текстовые узлы ---
      const kids = el.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const node = kids[i];
        if (node.nodeType !== 3) continue;
        const raw = node.textContent;
        const trimmed = raw.trim();
        if (!trimmed) continue;

        let origin = self.textOrigins.get(node);
        if (origin === undefined) {
          if (RU_RE.test(trimmed)) {
            // Первый визит: русский текст — это исходник
            origin = trimmed;
            self.textOrigins.set(node, origin);
          } else if (self.lang !== 'ru' && self.reverse && self.reverse[trimmed]) {
            // Уже переведённый динамический текст — переводим без кэша,
            // чтобы латинский контент не «онемел» при возврате в ru
            const next = self.t(self.reverse[trimmed]);
            if (next !== trimmed) node.textContent = raw.replace(trimmed, () => next);
            continue;
          } else {
            continue; // не наша строка — не трогаем
          }
        } else if (RU_RE.test(trimmed) && trimmed !== self.t(origin)) {
          // Текст вручную перезаписали русским — берём его как новый исходник
          origin = trimmed;
          self.textOrigins.set(node, origin);
        }
        const next = self.t(origin);
        if (next !== trimmed) node.textContent = raw.replace(trimmed, () => next);
      }

      // --- служебные атрибуты ---
      for (let a = 0; a < ATTRS.length; a++) {
        const attr = ATTRS[a];
        if (!el.hasAttribute(attr)) continue;
        const raw = el.getAttribute(attr);
        const trimmed = raw.trim();
        if (!trimmed) continue;

        const origins = self.attrOrigins.get(el) || {};
        let origin = origins[attr];
        if (origin === undefined) {
          if (RU_RE.test(trimmed)) {
            origin = trimmed;
            origins[attr] = origin;
            self.attrOrigins.set(el, origins);
          } else if (self.lang !== 'ru' && self.reverse && self.reverse[trimmed]) {
            const next = self.t(self.reverse[trimmed]);
            if (next !== raw) el.setAttribute(attr, next);
            continue;
          } else {
            continue;
          }
        } else if (RU_RE.test(trimmed) && trimmed !== self.t(origin)) {
          origin = trimmed;
          origins[attr] = origin;
        }
        const next = self.t(origin);
        if (next !== raw) el.setAttribute(attr, next);
      }

      const children = el.children;
      for (let i = 0; i < children.length; i++) visit(children[i]);
    };
    visit(document.body);
  },

  // Полное применение: язык, dir/lang, DOM, колбэк renderer
  applyAll() {
    this.lang = this.resolve();
    if (!this.reverse) this.buildReverse();
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('lang', this.lang);
      document.documentElement.setAttribute('dir', this.lang === 'he' ? 'rtl' : 'ltr');
    }
    this.applyDocument();
    if (typeof this.onApplied === 'function') {
      try {
        this.onApplied();
      } catch (e) {
        console.error('[i18n] onApplied:', e);
      }
    }
  },

  // Имя, которым пользуется renderer (init и селект языка)
  applyTranslations() {
    this.applyAll();
  }
};

// Первичное применение: настройки ещё не загружены — язык определяем по
// системе, а после разбора DOM проходим по странице повторно. renderer.js
// вызовет setLanguage() с сохранённым режимом, когда загрузит настройки.
if (typeof document !== 'undefined') {
  TranslationManager.lang = TranslationManager.resolve();
  if (document.documentElement) {
    document.documentElement.setAttribute('lang', TranslationManager.lang);
    document.documentElement.setAttribute('dir', TranslationManager.lang === 'he' ? 'rtl' : 'ltr');
  }
  if (!TranslationManager.reverse) TranslationManager.buildReverse();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      TranslationManager.applyTranslations();
    });
  } else {
    TranslationManager.applyTranslations();
  }
}

// Для тестов/Node (браузеру не нужно)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TranslationManager;
} else {
  // const в классическом скрипте не попадает в window — экспортируем явно,
  // renderer обращается именно как window.TranslationManager
  window.TranslationManager = TranslationManager;
}
