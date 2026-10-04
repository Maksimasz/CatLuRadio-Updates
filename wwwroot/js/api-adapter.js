// WebView2 API адаптер для CatLu Radio
console.log('[WebView2 API] Загрузка...');
console.log('[WebView2 API] window.chrome:', !!window.chrome);
console.log('[WebView2 API] window.chrome.webview:', !!window.chrome?.webview);

let callbackId = 0;
const callbacks = {};

// Промис, который никогда не завершается, вешал инициализацию приложения навсегда:
// если C#-сторона не отвечала (неизвестное действие, исключение внутри обработчика,
// сбой WebView2), страница оставалась пустой без единой ошибки в консоли.
// Теперь по таймауту резолвим null (вызывающий код это уже умеет обрабатывать
// через defaultValue/опциональную цепочку) и пишем в консоль.
const DEFAULT_TIMEOUT_MS = 20000;

const ACTION_TIMEOUT_MS = {
    // Диалоги выбора файла могут ждать решений пользователя долго, но не вечно:
    // C# отвечает всегда — и при OK, и при отмене.
    showOpenDialog: 10 * 60 * 1000,
    showSaveDialog: 10 * 60 * 1000,
    // Установщик качается целиком, на медленной линии это минуты.
    installUpdate: 30 * 60 * 1000
};

function sendToNative(action, data = {}, timeoutMs = null) {
    const limit = timeoutMs ?? ACTION_TIMEOUT_MS[action] ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve) => {
        const id = ++callbackId;

        const timeoutId = setTimeout(() => {
            if (!(id in callbacks)) return;
            delete callbacks[id];
            console.error(`[WebView2 API] Таймаут ${limit} мс, нет ответа на действие "${action}"`);
            resolve(null);
        }, limit);

        callbacks[id] = (result) => {
            clearTimeout(timeoutId);
            delete callbacks[id];
            resolve(result);
        };

        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(JSON.stringify({
                action,
                callbackId: id.toString(),
                ...data
            }));
        } else {
            console.error('[WebView2 API] window.chrome.webview не доступен!');
            clearTimeout(timeoutId);
            delete callbacks[id];
            resolve(null);
        }
    });
}

if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', (event) => {
        try {
            const data = JSON.parse(event.data);
            const id = data.callbackId;
            // Читаем resultRaw вместо result
            const result = data.resultRaw;
            if (callbacks[id] && result !== undefined) {
                callbacks[id](result);
                delete callbacks[id];
            }
        } catch (e) {
            console.error('[WebView2 API] Ошибка обработки ответа:', e, 'Data:', event.data);
        }
    });
    console.log('[WebView2 API] Инициализирован успешно');
} else {
    console.error('[WebView2 API] WebView2 не доступен!');
}

// Ответ хоста приходит уже разобранным объектом (resultRaw). Раньше в
// диалогах и файловых операциях стоял голый JSON.parse(result), который для
// объекта бросает SyntaxError "[object Object]" — и catch возвращал
// «диалог отменён». Из-за этого импорт и экспорт станций не работали:
// диалог всегда считался закрытым, а чтение/запись файла давали null/false.
function asNativeObject(result) {
    return typeof result === 'string' ? JSON.parse(result) : result;
}

const WebView2API = {
    async get(key, defaultValue = null) {
        try {
            const result = await sendToNative('getStore', { key });
            if (result === null || result === undefined || result === 'null') {
                return defaultValue;
            }
            return JSON.parse(result);
        } catch (e) {
            console.log('[WebView2 API] Ошибка чтения:', e);
            return defaultValue;
        }
    },

    async set(key, value) {
        try {
            const result = await sendToNative('setStore', { key, value });
            // Раньше здесь безусловно возвращался true: при таймауте или ошибке
            // страница считала настройки сохранёнными, хотя этого не произошло.
            return result?.success === true;
        } catch (e) {
            console.error('[WebView2 API] Ошибка записи:', e);
            return false;
        }
    },

    async httpGet(url) {
        try {
            const result = await sendToNative('httpGet', { url });
            const response = typeof result === 'string' ? JSON.parse(result) : result;
            return { success: response.success ?? response.Success, data: response.data ?? response.Data, error: response.error ?? response.Error };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    async checkStream(url) {
        const result = await sendToNative('checkStream', { url });
        const response = typeof result === 'string' ? JSON.parse(result) : result;
        return { success: response?.success ?? response?.Success, status: response?.status ?? response?.Status, error: response?.error ?? response?.Error };
    },
    playNative: (url, volume) => sendToNative('playNative', { url, volume }),
    pauseNative: () => sendToNative('pauseNative'),
    resumeNative: () => sendToNative('resumeNative'),
    stopNative: () => sendToNative('stopNative'),
    setNativeVolume: (volume) => sendToNative('setNativeVolume', { volume }),
    setNativeEqualizer: (values) => sendToNative('setNativeEqualizer', { values }),

    async showOpenDialog() {
        try {
            const response = asNativeObject(await sendToNative('showOpenDialog'));
            return response?.Success
                ? { canceled: false, filePaths: response.Data ?? [] }
                : { canceled: true, filePaths: [] };
        } catch (e) {
            console.error('[WebView2 API] Ошибка диалога открытия:', e);
            return { canceled: true, filePaths: [] };
        }
    },

    async showSaveDialog(options = {}) {
        try {
            const response = asNativeObject(await sendToNative('showSaveDialog', {
                defaultPath: options.defaultPath || 'file.json'
            }));
            return response?.Success
                ? { canceled: false, filePath: response.FilePath ?? null }
                : { canceled: true, filePath: null };
        } catch (e) {
            console.error('[WebView2 API] Ошибка диалога сохранения:', e);
            return { canceled: true, filePath: null };
        }
    },

    async readFile(path) {
        try {
            const response = asNativeObject(await sendToNative('readFile', { path }));
            // В ответе C# поле называется Content, а не content.
            if (!response?.Success) {
                console.error('[WebView2 API] readFile отклонён:', response?.Error ?? response?.error ?? 'нет доступа');
                return null;
            }
            return response.Content ?? '';
        } catch (e) {
            console.error('[WebView2 API] Ошибка чтения файла:', e);
            return null;
        }
    },

    async writeFile(path, content) {
        try {
            const response = asNativeObject(await sendToNative('writeFile', { path, content }));
            if (!response?.Success) {
                console.error('[WebView2 API] writeFile отклонён:', response?.Error ?? response?.error ?? 'нет доступа');
                return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    },

    setWindowSize: (width, height) => sendToNative('setWindowSize', { width, height }),
    setWindowResizable: (resizable) => sendToNative('setWindowResizable', { resizable }),
    setWindowMinimumSize: (width, height) => sendToNative('setWindowMinimumSize', { width, height }),

    exitApp: () => sendToNative('exitApp'),
    setMiniPlayer: (enabled) => sendToNative('setMiniPlayer', { enabled }),

    async closeWindow() {
        window.close();
        return true;
    },

    showNotification(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body });
        }
    },

    requestNotificationPermission() {
        if ('Notification' in window) {
            Notification.requestPermission();
        }
    }
};

window.AppAPI = {
    getStations: () => WebView2API.get('stations', []),
    saveStations: (s) => WebView2API.set('stations', s),
    getFavorites: () => WebView2API.get('favorites', []),
    saveFavorites: (f) => WebView2API.set('favorites', f),
    getSettings: () => WebView2API.get('settings', {
        language: 'auto',
        volume: 0.5,
        minimizeToTray: true,
        theme: 'system',
        sortType: 'name'
    }),
    saveSettings: (s) => WebView2API.set('settings', s),
    getStationsVersion: () => WebView2API.get('stationsVersion', null),
    saveStationsVersion: (v) => WebView2API.set('stationsVersion', v),
    getHistory: () => WebView2API.get('history', []),
    saveHistory: (h) => WebView2API.set('history', h),
    checkForUpdate: () => sendToNative('checkForUpdate'),
    installUpdate: (url) => sendToNative('installUpdate', { url }),
    checkStream: (url) => WebView2API.checkStream(url),
    playNative: (url, volume) => WebView2API.playNative(url, volume),
    pauseNative: () => WebView2API.pauseNative(),
    resumeNative: () => WebView2API.resumeNative(),
    stopNative: () => WebView2API.stopNative(),
    setNativeVolume: (volume) => WebView2API.setNativeVolume(volume),
    searchOnlineStations: async (name = '', country = '', portal = 'all') => {
        const include = source => portal === 'all' || portal === source;
        let radioBrowser = [];
        if (include('radio-browser')) {
            const query = new URLSearchParams({ hidebroken: 'true', order: 'votes', reverse: 'true', limit: name ? '30' : '500' });
            if (name) query.set('name', name);
            if (country) query.set('countrycode', country);
            const result = await WebView2API.httpGet(`https://de1.api.radio-browser.info/json/stations/search?${query}`);
            try { radioBrowser = result?.success ? JSON.parse(result.data).map(station => ({ ...station, source: 'Radio Browser' })) : []; } catch { /* Пустая выдача Radio Browser. */ }
            if (name) {
                const tagQuery = new URLSearchParams(query);
                tagQuery.delete('name');
                tagQuery.set('tag', name);
                const tagged = await WebView2API.httpGet(`https://de1.api.radio-browser.info/json/stations/search?${tagQuery}`);
                try {
                    const stations = tagged?.success ? JSON.parse(tagged.data).map(station => ({ ...station, source: 'Radio Browser' })) : [];
                    radioBrowser = [...new Map([...radioBrowser, ...stations].map(station => [station.stationuuid, station])).values()];
                } catch { /* По стилю Radio Browser ничего не вернул. */ }
            }
        }
        if (country && country !== 'RU' && country !== 'IL' && country !== 'LT') return radioBrowser;

        let stations101 = [];
        if (include('101ru') && (!country || country === 'RU')) {
            const response = await WebView2API.httpGet('https://101.ru/radio-top');
            try {
                const wanted = name.toLocaleLowerCase();
                stations101 = [...response.data.matchAll(/href="\/radio\/channel\/(\d+)"[\s\S]*?<span itemprop="name broadcastDisplayName">([^<]+)<\/span>/g)]
                    .map(([, id, title]) => ({
                        stationuuid: `101ru-${id}`, name: title.trim(), countrycode: 'RU', country: 'Россия',
                        tags: 'Other', lastcheckok: 1, source: '101.ru', channelId: id
                    }))
                    .filter(station => !wanted || station.name.toLocaleLowerCase().includes(wanted));
            } catch { /* Пустая выдача 101.ru. */ }
        }

        let rlive = [];
        if (include('rlive') && (!country || country === 'IL')) {
            try {
                const wanted = name.toLocaleLowerCase();
                const seen = new Set();
                const response = await WebView2API.httpGet('https://www.rlive.co.il/site-map');
                rlive = [...response.data.matchAll(/<a href="\/station\/([^"?#]+)"[^>]*>([^<]+)<\/a>/g)]
                    .map(([, slug, title]) => ({
                        stationuuid: `rlive-${slug}`, name: new DOMParser().parseFromString(title, 'text/html').body.textContent.trim(),
                        countrycode: 'IL', country: 'Израиль',
                        tags: 'Other', lastcheckok: 1, source: 'RLive', portalUrl: `https://www.rlive.co.il/station/${slug}`
                    }))
                    .filter(station => !seen.has(station.stationuuid) && seen.add(station.stationuuid))
                    .filter(station => !wanted || station.name.toLocaleLowerCase().includes(wanted));
            } catch { /* Пустая выдача RLive. */ }
        }
        if (country === 'IL') return [...radioBrowser, ...rlive];

        let dfm = [];
        if (include('dfm') && (!country || country === 'RU')) {
            try {
                const wanted = name.toLocaleLowerCase();
                const seen = new Set();
                const response = await WebView2API.httpGet('https://dfm.ru/online');
                dfm = [...response.data.matchAll(/\\"id\\":(\d+),\\"title\\":\\"(.*?)\\"[\s\S]{0,1200}?\\"url\\":\\"(https:[^\\]+?\.m3u8[^\\"]*)/g)]
                    .map(([, id, title, url]) => ({
                        stationuuid: `dfm-${id}`, name: title, url, url_resolved: url,
                        countrycode: 'RU', country: 'Россия', tags: 'Other', lastcheckok: 1, source: 'DFM'
                    }))
                    .filter(station => !seen.has(station.url) && seen.add(station.url))
                    .filter(station => !wanted || station.name.toLocaleLowerCase().includes(wanted));
            } catch { /* Пустая выдача DFM. */ }
        }

        let maximum = [];
        if (include('maximum') && (!country || country === 'RU')) {
            try {
                const wanted = name.toLocaleLowerCase();
                const seen = new Set();
                const response = await WebView2API.httpGet('https://maximum.ru/online');
                maximum = [...response.data.matchAll(/\\"id\\":(\d+),\\"title\\":\\"(.*?)\\"[\s\S]{0,1200}?\\"url\\":\\"(https:[^\\]+?\.m3u8[^\\"]*)/g)]
                    .map(([, id, title, url]) => ({
                        stationuuid: `maximum-${id}`, name: title.replace(/\\u0026/g, '&'), url, url_resolved: url,
                        countrycode: 'RU', country: 'Россия', tags: 'Other', lastcheckok: 1, source: 'Maximum'
                    }))
                    .filter(station => !seen.has(station.url) && seen.add(station.url))
                    .filter(station => !wanted || station.name.toLocaleLowerCase().includes(wanted));
            } catch { /* Пустая выдача Maximum. */ }
        }

        let radijoStotys = [];
        if (include('radijo-stotys') && (!country || country === 'LT')) {
            try {
                const wanted = name.toLocaleLowerCase();
                const pages = await Promise.all(['', '&page=2', '&page=3'].map(page =>
                    WebView2API.httpGet(`https://radijo-stotys.lt/stations?sort=az${page}`)));
                radijoStotys = pages.flatMap(response =>
                    [...response.data.matchAll(/data-station-id="(\d+)"[\s\S]*?data-stream-url="([^"]+)"[\s\S]*?data-title="([^"]+)"[\s\S]*?data-logo="([^"]+)"/g)])
                    .map(([, id, url, title, image]) => ({
                        stationuuid: `radijo-stotys-${id}`, name: title, url, url_resolved: url, image,
                        countrycode: 'LT', country: 'Литва', tags: 'Other', lastcheckok: 1, source: 'Radijo-stotys.lt'
                    }))
                    .filter(station => !wanted || station.name.toLocaleLowerCase().includes(wanted));
            } catch { /* Пустая выдача Radijo-stotys.lt. */ }
        }
        if (country === 'LT') return [...radioBrowser, ...radijoStotys];

        // ponytail: RadioPotok не публикует API поиска; берём каталог главной страницы.
        if (!include('radiopotok')) return [...radioBrowser, ...stations101, ...dfm, ...maximum, ...rlive, ...radijoStotys];
        const radioPotok = await WebView2API.httpGet('https://radiopotok.ru/');
        try {
            const wanted = name.toLocaleLowerCase();
            const stations = [...radioPotok.data.matchAll(/STATIONS\[\d+\]\s*=\s*(\{.*?\});/g)].map(match => JSON.parse(match[1]));
            const radioPotokStations = stations.map(station => {
                const url = JSON.parse(station.stream || '[]')[0]?.file;
                return url && (!wanted || station.name.toLocaleLowerCase().includes(wanted)) && {
                    stationuuid: `radiopotok-${station.id}`, name: station.name, url, url_resolved: url,
                    countrycode: 'RU', country: 'Россия', tags: 'Other', lastcheckok: 1, source: 'RadioPotok'
                };
            }).filter(Boolean);
            return [...radioBrowser, ...stations101, ...dfm, ...maximum, ...rlive, ...radijoStotys, ...radioPotokStations];
        } catch { return [...radioBrowser, ...stations101, ...dfm, ...maximum, ...rlive, ...radijoStotys]; }
    },
    resolvePortalStation: async (station) => {
        if (station.source === '101.ru') {
            const response = await WebView2API.httpGet(`https://101.ru/api/channel/getServers/${station.channelId}/channel/AAC/64/dataFormat/mobile`);
            try { return JSON.parse(response.data).result?.find(item => item.protocols === 'https')?.urlStream || ''; } catch { return ''; }
        }
        if (station.source === 'RLive') {
            const response = await WebView2API.httpGet(station.portalUrl);
            const url = response.data.match(/\\"streamUrl\\":\\"([^\\"]+)/)?.[1] || '';
            return url === 'https://rs.mizrahit.fm:7777/;stream' ? 'https://rs.mizrahit.fm/' : url;
        }
        const url = station.url_resolved || station.url || '';
        // Radijo-stotys.lt сам передаёт HTTP-потоки через этот HTTPS-прокси.
        return station.source === 'Radijo-stotys.lt' && url.startsWith('http://')
            ? `https://a.tunzilla.com/${url}`
            : url;
    },

    exportStations: async (stations) => {
        const exportData = { stations: {} };
        stations.forEach((station, i) => {
            const id = station.id || `station_${Date.now()}_${i}`;
            exportData.stations[id] = {
                name: id,
                title: station.name,
                url: station.url || '',
                image: station.image || '',
                streams: { '0': station.url }
            };
        });
        const result = await WebView2API.showSaveDialog({ defaultPath: 'CatLu-radio-stations.json' });
        if (!result.canceled && result.filePath) {
            await WebView2API.writeFile(result.filePath, JSON.stringify(exportData, null, 2));
            return { success: true, path: result.filePath };
        }
        return { success: false, canceled: true };
    },

    importStations: async () => {
        const result = await WebView2API.showOpenDialog();
        if (result.canceled || !result.filePaths?.length) {
            return { success: false, canceled: true };
        }
        const content = await WebView2API.readFile(result.filePaths[0]);
        if (!content) return { success: false, error: 'Не удалось прочитать файл' };
        try {
            const data = JSON.parse(content);
            const imported = [];
            if (data.stations) {
                Object.keys(data.stations).forEach(id => {
                    const s = data.stations[id];
                    const url = s.streams?.['0'] || s.streams?.[0] || s.url;
                    if (url) {
                        imported.push({
                            id: `imported_${id}_${Date.now()}`,
                            name: s.title || s.name || 'Station',
                            url,
                            country: 'OTHER',
                            genre: 'Other',
                            image: s.image || ''
                        });
                    }
                });
            }
            return { success: true, imported, total: imported.length };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    extractTuneInStream: (url) => WebView2API.httpGet(url),
    extractRadioPotokStream: (url) => WebView2API.httpGet(url),
    closeWindow: () => WebView2API.closeWindow(),
    exitApp: () => WebView2API.exitApp(),
    setMiniPlayer: (enabled) => WebView2API.setMiniPlayer(enabled),
    setWindowSize: (w, h) => WebView2API.setWindowSize(w, h),
    setWindowResizable: (r) => WebView2API.setWindowResizable(r),
    setWindowMinimumSize: (w, h) => WebView2API.setWindowMinimumSize(w, h)
};

console.log('[WebView2 API] AppAPI готов');
