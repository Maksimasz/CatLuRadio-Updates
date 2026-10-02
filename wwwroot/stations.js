// Предустановленный список радиостанций из CatLu-radio-stations.json
// Эти станции используются как отправная точка при первом запуске
// ВСЕ станции должны быть ТОЛЬКО из этого файла - это проверенные рабочие станции

// Версия предустановленных станций (увеличивать при обновлении списка)
// Изменение версии принудительно обновит все предустановленные станции
const DEFAULT_STATIONS_VERSION = '1.0.3';

// Встроенные данные из CatLu-radio-stations.json
const STATIONS_JSON_DATA = {
  "stations": {
    "imported_17496369999090_1763531617805": {
      "name": "imported_17496369999090_1763531617805",
      "title": "Первое радио Израиль",
      "url": "https://cdn.cybercdn.live/Pervoia/Audio/icecast.audio",
      "image": "https://dyjvnjd6yl5jx.cloudfront.net/wp-content/uploads/2020/09/pervoe-radio-logo_ediniza.png",
      "streams": {
        "0": "https://cdn.cybercdn.live/Pervoia/Audio/icecast.audio"
      }
    },
    "imported_17496375815921_1763531617805": {
      "name": "imported_17496375815921_1763531617805",
      "title": "Лучшее радио",
      "url": "https://servidor35.brlogic.com:7080/live",
      "image": "https://topradio.mobi/screen/1649686125_luchshee_radio_ierusalim_izrail.jpg",
      "streams": {
        "0": "https://servidor35.brlogic.com:7080/live"
      }
    },
    "imported_17496386485972_1763531617805": {
      "name": "imported_17496386485972_1763531617805",
      "title": "Радио Reka",
      "url": "https://playerservices.streamtheworld.com/api/livestream-redirect/KAN_REKA.mp3",
      "image": "https://www.allmyradio.com/images/radio/stations/ru/Радио-РЭКА.png",
      "streams": {
        "0": "https://playerservices.streamtheworld.com/api/livestream-redirect/KAN_REKA.mp3"
      }
    },
    "user-1763548352428": {
      "name": "user-1763548352428",
      "title": "M1",
      "url": "http://radio.m-1.fm:80/M-1",
      "image": "",
      "streams": {
        "0": "http://radio.m-1.fm:80/M-1"
      }
    },
    "user-1763548947542": {
      "name": "user-1763548947542",
      "title": "Авторадио",
      "url": "https://srv01.gpmradio.ru/stream/air/aac/64/100?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJrZXkiOiJiNGZiZTI0YTM0MzI5MzBlMTVkMzE0MmNjZWFkNDU2OCIsIklQIjoiODEuMTk5LjEzNS4xNzAiLCJVQSI6Ik1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xNDAuMC4wLjAgWWFCcm93c2VyLzI1LjEwLjAuMCBTYWZhcmkvNTM3LjM2IiwiUmVmIjoiaHR0cHM6Ly8xMDEucnUvIiwidWlkX2NoYW5uZWwiOiIxMDAiLCJ0eXBlX2NoYW5uZWwiOiJjaGFubmVsIiwidHlwZURldmljZSI6IlBDIiwiQnJvd3NlciI6IkNocm9tZSIsIkJyb3dzZXJWZXJzaW9uIjoiMTQwLjAuMC4wIiwiU3lzdGVtIjoiV2luZG93cyAxMCIsImV4cCI6MTc2MzU5MjAzMH0.YBqaR818D6lY6AFd_g2nfoo3gwMloWx5_raE0vMOiYk",
      "image": "",
      "streams": {
        "0": "https://srv01.gpmradio.ru/stream/air/aac/64/100?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJrZXkiOiJiNGZiZTI0YTM0MzI5MzBlMTVkMzE0MmNjZWFkNDU2OCIsIklQIjoiODEuMTk5LjEzNS4xNzAiLCJVQSI6Ik1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xNDAuMC4wLjAgWWFCcm93c2VyLzI1LjEwLjAuMCBTYWZhcmkvNTM3LjM2IiwiUmVmIjoiaHR0cHM6Ly8xMDEucnUvIiwidWlkX2NoYW5uZWwiOiIxMDAiLCJ0eXBlX2NoYW5uZWwiOiJjaGFubmVsIiwidHlwZURldmljZSI6IlBDIiwiQnJvd3NlciI6IkNocm9tZSIsIkJyb3dzZXJWZXJzaW9uIjoiMTQwLjAuMC4wIiwiU3lzdGVtIjoiV2luZG93cyAxMCIsImV4cCI6MTc2MzU5MjAzMH0.YBqaR818D6lY6AFd_g2nfoo3gwMloWx5_raE0vMOiYk"
      }
    },
    "user-1764912254171": {
      "name": "user-1764912254171",
      "title": "Радио Хит",
      "url": "https://hit.trkeurasia.ru/hit128?st=c231d319-0d68-5fb5-af07-51de6ad48f9f&gts=1764913482",
      "image": "",
      "streams": {
        "0": "https://hit.trkeurasia.ru/hit128?st=c231d319-0d68-5fb5-af07-51de6ad48f9f&gts=1764913482"
      }
    },
    "imported_russian-radio_1764914971959": {
      "name": "imported_russian-radio_1764914971959",
      "title": "Русское Радио",
      "url": "https://rusradio.hostingradio.ru/rusradio96.aacp",
      "image": "",
      "streams": {
        "0": "https://rusradio.hostingradio.ru/rusradio96.aacp"
      }
    },
    "imported_europa-plus_1764914971959": {
      "name": "imported_europa-plus_1764914971959",
      "title": "Европа Плюс",
      "url": "https://ep256.hostingradio.ru:8052/europaplus256.mp3",
      "image": "",
      "streams": {
        "0": "https://ep256.hostingradio.ru:8052/europaplus256.mp3"
      }
    },
    "imported_dorozhnoe-radio_1764914971959": {
      "name": "imported_dorozhnoe-radio_1764914971959",
      "title": "Дорожное Радио",
      "url": "https://dorognoe.hostingradio.ru:8000/dorognoe",
      "image": "",
      "streams": {
        "0": "https://dorognoe.hostingradio.ru:8000/dorognoe"
      }
    },
    "imported_radio-record_1764914971959": {
      "name": "imported_radio-record_1764914971959",
      "title": "Radio Record",
      "url": "https://radiorecord.hostingradio.ru/rr_main96.aacp",
      "image": "",
      "streams": {
        "0": "https://radiorecord.hostingradio.ru/rr_main96.aacp"
      }
    },
    "user-1764916596687": {
      "name": "user-1764916596687",
      "title": "Русская волна",
      "url": "https://irp.volna.top/ruwave?st=db0fbf33-bad1-5d34-90ab-22531995a7a0&gts=1764916552",
      "image": "",
      "streams": {
        "0": "https://irp.volna.top/ruwave?st=db0fbf33-bad1-5d34-90ab-22531995a7a0&gts=1764916552"
      }
    },
    "user-1764917040802": {
      "name": "user-1764917040802",
      "title": "DFM радио",
      "url": "https://dfm.hostingradio.ru/dfm96.aacp?st=52b9397c-eb1b-5ace-b29d-d4437dd3deaf&gts=1764916999",
      "image": "",
      "streams": {
        "0": "https://dfm.hostingradio.ru/dfm96.aacp?st=52b9397c-eb1b-5ace-b29d-d4437dd3deaf&gts=1764916999"
      }
    },
    "user-1764917161637": {
      "name": "user-1764917161637",
      "title": "Remix FM",
      "url": "https://irp2.volna.top/remixfm?st=77b037a7-431c-5952-81f5-82438a958e13&gts=1764917131",
      "image": "",
      "streams": {
        "0": "https://irp2.volna.top/remixfm?st=77b037a7-431c-5952-81f5-82438a958e13&gts=1764917131"
      }
    },
    "imported_user-1765350793448_1765356081205": {
      "name": "imported_user-1765350793448_1765356081205",
      "title": "Маруся ФМ",
      "url": "https://msk14.radio-holding.ru/marusya_default",
      "image": "",
      "streams": {
        "0": "https://msk14.radio-holding.ru/marusya_default"
      }
    },
    "imported_user-1765351617112_1765356081205": {
      "name": "imported_user-1765351617112_1765356081205",
      "title": "Energy",
      "url": "https://hls-01-gpm.hostingradio.ru/energyfm495/playlist.m3u8",
      "image": "",
      "streams": {
        "0": "https://hls-01-gpm.hostingradio.ru/energyfm495/playlist.m3u8"
      }
    },
    "imported_user-1765354063881_1765356081205": {
      "name": "imported_user-1765354063881_1765356081205",
      "title": "Ретро Хит",
      "url": "https://retro.amgradio.ru/Retro",
      "image": "",
      "streams": {
        "0": "https://retro.amgradio.ru/Retro"
      }
    },
    "imported_user-1765354433316_1765356081205": {
      "name": "imported_user-1765354433316_1765356081205",
      "title": "DANCE FM",
      "url": "https://myradio24.org/dmfm",
      "image": "",
      "streams": {
        "0": "https://myradio24.org/dmfm"
      }
    },
    "imported_user-1765354873860_1765356081205": {
      "name": "imported_user-1765354873860_1765356081205",
      "title": "Radios 100fm",
      "url": "https://cdn.cybercdn.live/Radios_100FM/Audio/icecast.audio",
      "image": "",
      "streams": {
        "0": "https://cdn.cybercdn.live/Radios_100FM/Audio/icecast.audio"
      }
    }
  }
};

// Функция для определения страны по URL
function detectCountryFromUrl(url) {
  if (!url) return 'OTHER';
  
  const urlLower = url.toLowerCase();
  
  // Определение по домену
  if (urlLower.includes('.ru') || urlLower.includes('hostingradio.ru') || 
      urlLower.includes('gpmradio.ru') || urlLower.includes('trkeurasia.ru') ||
      urlLower.includes('volna.top') || urlLower.includes('m-1.fm')) {
    return 'RU';
  }
  
  if (urlLower.includes('.il') || urlLower.includes('cybercdn.live') || 
      urlLower.includes('brlogic.com') || urlLower.includes('streamtheworld.com')) {
    return 'IL';
  }
  
  return 'OTHER';
}

// Функция для определения жанра по названию
function detectGenreFromName(name) {
  if (!name) return 'Pop';
  
  const nameLower = name.toLowerCase();
  
  // Определение жанра по ключевым словам
  if (nameLower.includes('record') || nameLower.includes('remix') || 
      nameLower.includes('dance') || nameLower.includes('electronic')) {
    return 'Dance';
  }
  
  if (nameLower.includes('rock')) {
    return 'Rock';
  }
  
  if (nameLower.includes('classical') || nameLower.includes('классик')) {
    return 'Classical';
  }
  
  if (nameLower.includes('news') || nameLower.includes('новост')) {
    return 'News';
  }
  
  if (nameLower.includes('talk') || nameLower.includes('разговор')) {
    return 'Talk';
  }
  
  // По умолчанию Pop
  return 'Pop';
}

// Функция для конвертации данных из JSON формата в формат приложения
function convertStationsFromJson(jsonData) {
  const stations = [];
  const seenUrls = new Set(); // Для удаления дубликатов по URL
  
  console.log('convertStationsFromJson вызвана');
  console.log('jsonData:', jsonData);
  
  if (!jsonData || !jsonData.stations) {
    console.warn('Некорректный формат JSON данных станций');
    console.warn('jsonData:', jsonData);
    return stations;
  }
  
  const stationKeys = Object.keys(jsonData.stations);
  console.log('Найдено станций в JSON:', stationKeys.length);
  
  stationKeys.forEach((stationId, index) => {
    const stationData = jsonData.stations[stationId];
    console.log(`Обработка станции ${index + 1}/${stationKeys.length}:`, stationId, stationData);
    
    // Получаем URL из streams или url
    const streamUrl = stationData.streams?.['0'] || stationData.streams?.[0] || stationData.url || '';
    
    console.log(`  URL станции:`, streamUrl);
    
    // Пропускаем дубликаты по URL
    if (!streamUrl) {
      console.warn(`  Пропущена станция ${stationId}: нет URL`);
      return;
    }
    
    if (seenUrls.has(streamUrl)) {
      console.warn(`  Пропущена станция ${stationId}: дубликат URL`);
      return;
    }
    seenUrls.add(streamUrl);
    
    // Получаем название из title или name
    const stationName = stationData.title || stationData.name || 'Неизвестная станция';
    console.log(`  Название:`, stationName);
    
    // Определяем страну и жанр
    const country = detectCountryFromUrl(streamUrl);
    const genre = detectGenreFromName(stationName);
    console.log(`  Страна:`, country, 'Жанр:', genre);
    
    // Создаем объект станции
    const station = {
      id: stationId,
      name: stationName,
      url: streamUrl,
      country: country,
      genre: genre
    };
    
    // Добавляем изображение если есть
    if (stationData.image) {
      station.image = stationData.image;
    }
    
    stations.push(station);
    console.log(`  Станция добавлена:`, station);
  });
  
  console.log('Итого конвертировано станций:', stations.length);
  return stations;
}

function getDefaultStations() {
  console.log('=== getDefaultStations вызвана ===');
  console.log('STATIONS_JSON_DATA существует:', !!STATIONS_JSON_DATA);
  console.log('STATIONS_JSON_DATA.stations существует:', !!(STATIONS_JSON_DATA && STATIONS_JSON_DATA.stations));
  if (STATIONS_JSON_DATA && STATIONS_JSON_DATA.stations) {
    const stationKeys = Object.keys(STATIONS_JSON_DATA.stations);
    console.log('Количество станций в STATIONS_JSON_DATA:', stationKeys.length);
    console.log('Первые 3 ключа:', stationKeys.slice(0, 3));
  }
  
  // Конвертируем данные из JSON формата в формат приложения
  const stations = convertStationsFromJson(STATIONS_JSON_DATA);
  console.log('✅ getDefaultStations возвращает:', stations.length, 'станций');
  if (stations.length === 0) {
    console.error('❌ КРИТИЧНО: getDefaultStations вернула пустой массив!');
    console.error('STATIONS_JSON_DATA:', JSON.stringify(STATIONS_JSON_DATA).substring(0, 500));
  }
  return stations;
}

// Экспорт для использования в renderer.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getDefaultStations, DEFAULT_STATIONS_VERSION };
} else {
  window.getDefaultStations = getDefaultStations;
  window.DEFAULT_STATIONS_VERSION = DEFAULT_STATIONS_VERSION;
}
