const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'js', 'renderer.js'), 'utf8');

if (!source.includes('if (state.isPlaying) return;')) throw new Error('Нет защиты от устаревшей ошибки');
if (!source.includes('function rememberLastStation') || !source.includes('if (!state.isClosing) clearLastStation();')) throw new Error('Автозапуск последней станции не различает остановку и закрытие');
if (source.includes('setTimeout(checkAllStations, 1500)')) throw new Error('Массовая проверка мешает автозапуску');
if (!source.includes('autoPlayLastStation();\n  }, 2000);')) throw new Error('Автозапуск начинается до инициализации WebView2');
if (!source.includes('await window.AppAPI.stopNative();\n  state.nativeAudio = false;')) throw new Error('libVLC не останавливается перед переключением');
if (!source.includes('const useCrossfade = crossfadeEnabled && state.audio && state.isPlaying;')) throw new Error('Кроссфейд выключен');
if (!source.includes('setTimeout(stopOldAudio, crossfadeDuration + 500);')) throw new Error('Старый поток не останавливается после кроссфейда');
if (!source.includes('terminalErrorPending')) throw new Error('Нет блокировки повторной финальной ошибки');
if (source.includes('!station.incompatible && result?.success')) throw new Error('Старая метка блокирует повторную проверку');
if (!source.includes('state.nativeAudio = true')) throw new Error('Нет резервного проигрывателя');
if (!source.includes("streamUrl.startsWith('http://') && streamCheck?.success")) throw new Error('HTTPS-поток ошибочно передаётся в резервный проигрыватель');
if (!source.includes("addEventListener('playing', handlePlay)")) throw new Error('Статус воспроизведения ставится до появления звука');
// Раньше здесь стоял гейт `const equalizerEnabled = useHLS`: он отключал
// Web Audio на всех прямых потоках (18 из 19 станций), из-за чего «перестал
// работать эквалайзер». Теперь обработка (эквалайзер и выравнивание
// громкости) подключается ко всем станциям, а серверы без CORS получают
// аварийный перезапуск уже без обработки — чтобы не молчать.
if (!source.includes('const processingWanted =')) throw new Error('Обработка звука не подключена к прямым потокам');
if (!source.includes('state.streamsWithoutWebAudio.add(streamUrl)')) throw new Error('Нет аварийного перезапуска потока без CORS');
if (source.includes('station && state.stationHealth[station.id] !== false')) throw new Error('Проверка потока блокирует запуск станции');
if (!source.includes('delete state.stationHealth[station.id];')) throw new Error('Неудачная фоновая проверка помечает станцию недоступной');
if (!source.includes('if (!crossfadeEnabled)') || !source.includes('const nativeResult = await window.AppAPI.playNative(streamUrl, state.volume);')) throw new Error('LibVLC не запускается первым для обычного переключения');
if (!source.includes("streamUrl.startsWith('http://') && streamCheck?.success")) throw new Error('Браузерный резерв изменён без проверки HTTP-потока');
if (!source.includes('state.audio || state.nativeAudio')) throw new Error('Кнопки отключаются при резервном воспроизведении');
if (!source.includes('setInterval(checkAllStations, 15 * 60 * 1000)')) throw new Error('Нет автоматической проверки станций');
if (!source.includes("searchOnlineStations(query, country === 'all' ? '' : country, portal)")) throw new Error('Портал не передаётся в интернет-поиск');
if (!source.includes("preview: true") || !source.includes("!station.preview")) throw new Error('Предпрослушивание не отделено от добавления');
if (!source.includes("!state.settings.scheduler?.schedules?.[index] || !confirm('Удалить это расписание?')")) throw new Error('Удаление расписания не подтверждается');
// Мост событий C#→страницы не существует (MainForm шлёт только ответы по
// callbackId), поэтому прямой вызов window.AppAPI.on* роняет init() дальше:
// без перевоводов, проверки обновлений и автозапуска последней станции.
if (/window\.AppAPI\.on[A-Z]/.test(source)) throw new Error('IPC-слушатели вызывают несуществующие on*-события AppAPI и обрывают init()');
if (!source.includes("typeof window.AppAPI?.[name] === 'function'")) throw new Error('IPC-слушатели не проверяют, есть ли событие у AppAPI');

const adapter = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'js', 'api-adapter.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'index.html'), 'utf8');
if (!source.includes('setNativeEqualizer') || !adapter.includes('setNativeEqualizer:')) throw new Error('Эквалайзер не передаётся в libVLC');
if (!source.includes('state.nativeAudio = true;\n      await window.AppAPI.setNativeEqualizer')) throw new Error('Эквалайзер libVLC включается до старта потока');
if (!adapter.includes('response.success ?? response.Success')) throw new Error('HTTP-ответ C# не приводится к формату поиска');
if (!adapter.includes("typeof result === 'string' ? JSON.parse(result) : result")) throw new Error('HTTP-ответ-объект повторно разбирается как JSON');
if (!adapter.includes("success: response?.success ?? response?.Success")) throw new Error('Проверка потока не приводит поле Success из C#');
if (!adapter.includes("WebView2API.httpGet('https://radiopotok.ru/')")) throw new Error('RadioPotok не подключён к поиску');
if (!adapter.includes("https://www.rlive.co.il/site-map") || !adapter.includes("source: 'RLive'")) throw new Error('RLive не подключён к полному каталогу');
if (!adapter.includes("https://rs.mizrahit.fm/") || !source.includes("streamUrl = station.url = 'https://rs.mizrahit.fm/'")) throw new Error('Поток RLive Mizrahit не приводится к конечному адресу');
if (!adapter.includes("https://radijo-stotys.lt/stations?sort=az${page}") || !adapter.includes("source: 'Radijo-stotys.lt'")) throw new Error('Radijo-stotys.lt не подключён к поиску');
if (!adapter.includes('https://a.tunzilla.com/${url}')) throw new Error('HTTP-потоки Radijo-stotys.lt не переводятся в HTTPS');
if (!adapter.includes("WebView2API.httpGet('https://dfm.ru/online')") || !adapter.includes("source: 'DFM'")) throw new Error('DFM не подключён к поиску');
if (!adapter.includes("WebView2API.httpGet('https://maximum.ru/online')") || !adapter.includes("source: 'Maximum'")) throw new Error('Maximum не подключён к поиску');
if (!adapter.includes("tagQuery.set('tag', name)") || !adapter.includes('new Map([...radioBrowser, ...stations]')) throw new Error('Поиск по стилю Radio Browser не подключён');
if (!adapter.includes('<a href="\\/station\\/') || !adapter.includes('site-map')) throw new Error('RLive не разбирает полный каталог станций');
if (!adapter.includes("include('101ru')") || !adapter.includes("https://101.ru/radio-top")) throw new Error('101.ru не подключён к меню порталов');
if (!adapter.includes('resolvePortalStation')) throw new Error('Для 101.ru не извлекается актуальный поток');
if (!source.includes('results.hidden = true;\n      results.replaceChildren();')) throw new Error('Результаты поиска остаются открытыми после добавления');
if (!source.includes("document.getElementById('filterSelect').value = 'all';")) throw new Error('После добавления остаётся фильтр страны');
if (!source.includes('<details class="country-group"') || !source.includes("group.addEventListener('toggle'")) throw new Error('Нет аккордеона станций по странам');
if (!source.includes("getElementById('onlineSearchInput')") || !source.includes("switchTab('stations');")) throw new Error('Онлайн-поиск не вынесен в отдельную вкладку');
if ((index.match(/<optgroup label="СНГ">/g) || []).length !== 3 || (index.match(/<optgroup label="Европа">/g) || []).length !== 3) throw new Error('Страны СНГ и Европы добавлены не во все списки');
if (index.includes('value="UK"') || !index.includes('value="GB"')) throw new Error('Код Великобритании не совместим с Radio Browser');
if (!index.includes('id="onlinePortalSelect"') || !index.includes('value="all"') || !index.includes('value="101ru"') || !index.includes('value="dfm"') || !index.includes('value="maximum"') || !index.includes('value="rlive"') || !index.includes('value="radijo-stotys"') || index.includes('value="fm-lt"') || index.includes('value="radijo-lt"') || index.includes('value="radio-lt"')) throw new Error('Меню порталов содержит неверный источник');
if (!source.includes("found.source || 'Radio Browser'")) throw new Error('Источник станции не показан в поиске');
if (!index.includes('placeholder="Название, стиль, исполнитель или годы"')) throw new Error('Подсказка общего поиска не обновлена');
if (!source.includes('onlineStationKey(station.name)') || !source.includes('backupSources.push(station)') || !source.includes('backupUrls')) throw new Error('Дубли поиска не объединяются в запасные потоки');
if (source.includes("${found.codec || '?'} ${found.bitrate || '?'} kbps")) throw new Error('В результатах поиска остались кодек и битрейт');
if (!source.includes('checkForUpdates();') || !source.includes('installAvailableUpdate')) throw new Error('Проверка обновлений при запуске не подключена');
if (!adapter.includes("checkForUpdate: () => sendToNative('checkForUpdate')")) throw new Error('Проверка обновлений не передаётся в приложение');
if (!index.includes('id="system"') || !index.includes('id="checkUpdateBtn"') || !index.includes('Maksimasz/CatLuRadio-Updates')) throw new Error('Обновления не размещены в разделе системы');

// alert() блокирует страницу: при серии ошибок воспроизведения складывалась
// стопка одинаковых системных окон, которые надо закрывать руками. Всё, что
// раньше было alert(), стало showToast(); confirm() для подтверждения
// удаления и сброса остаётся — там блокировка и нужна.
if (/^\s*alert\(/m.test(source)) throw new Error('В renderer остался блокирующий alert() вместо showToast()');
if (!source.includes('function showToast(')) throw new Error('Нет showToast() — уведомления некуда показывать');
if (!index.includes('id="toastRoot"')) throw new Error('В index.html нет контейнера toastRoot');

console.log('Playback guards: OK');
