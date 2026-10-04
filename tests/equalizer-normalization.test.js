const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'js', 'renderer.js'), 'utf8');
const equalizer = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'modules', 'Equalizer.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'wwwroot', 'index.html'), 'utf8');

// Эквалайзер и выравнивание громкости работают на всех станциях
if (!source.includes('const eqWanted = !!(state.settings.equalizer && state.settings.equalizer.enabled && window.Equalizer);')) {
  throw new Error('Эквалайзер не включается на всех потоках');
}
if (source.includes('useHLS && state.settings.equalizer')) {
  throw new Error('Вернулся гейт useHLS — эквалайзер снова только для HLS');
}
if (!source.includes('if (processingWanted || useHLS)')) {
  throw new Error('crossOrigin не выставляется для обработки прямых потоков');
}

// Выравнивание громкости: настройка по умолчанию, слияние при загрузке, UI
if (!source.includes('normalization: {\n      enabled: true // Выравнивание громкости станций (компрессор)\n    },')) {
  throw new Error('Нет настройки normalization по умолчанию');
}
if (!source.includes('normalization: {\n          ...state.settings.normalization,\n          ...(savedSettings.normalization || {})\n        },')) {
  throw new Error('Настройка normalization не переживает загрузку сохранённых настроек');
}
if (!index.includes('id="normEnableChk"') || !index.includes('id="eqEnableChk"')) {
  throw new Error('Нет чекбоксов эквалайзера и выравнивания громкости');
}
if (!source.includes('normEnableChk.onchange') || !source.includes('eqEnableChk.onchange')) {
  throw new Error('Чекбоксы обработки звука не подключены');
}
if (!source.includes('function applyAudioProcessingChange()')) {
  throw new Error('Переключение обработки звука не применяется на лету');
}

// Компрессор выравнивания в цепочке Web Audio
if (!equalizer.includes('createDynamicsCompressor')) {
  throw new Error('В Equalizer нет компрессора выравнивания громкости');
}
if (!equalizer.includes('makeupGain') || !equalizer.includes('NORMALIZATION')) {
  throw new Error('Нет makeup-усиления после компрессора');
}
if (!equalizer.includes('this.compressor.connect(this.makeupGain)') || !equalizer.includes('this.makeupGain.connect(this.gainNode)')) {
  throw new Error('Компрессор не вставлен в цепочку обработки');
}
if (!equalizer.includes('configure(options = {})')) {
  throw new Error('Блоки обработки нельзя переключать на лету');
}

// Громкость при подключённом элементе идёт через gain графа
if (!source.includes('function applyPlaybackVolume(volume)')) {
  throw new Error('Ползунок громкости не учитывает граф Web Audio');
}
if (!source.includes('state.equalizer.setVolume(volume)')) {
  throw new Error('Громкость не применяется к gain графа');
}
if (!source.includes('state.equalizer.isAttachedTo(audioElement)) ? 1 : state.volume')) {
  throw new Error('Fade in не доводит подключённый к графу элемент до полной громкости');
}

// Аварийный перезапуск потоков без CORS — до ретраев и только до первой игры
if (!source.includes('retryState.canFallbackToNoWebAudio && !audioElement.__reachedPlaying')) {
  throw new Error('Нет условия аварийного перезапуска потока без CORS');
}
if (source.indexOf('retryState.canFallbackToNoWebAudio && !audioElement.__reachedPlaying') > source.indexOf('contentType === \'audio/mpeg\' && retryState.retryCount < retryState.maxRetries')) {
  throw new Error('Перезапуск без CORS должен идти раньше ретраев MP3');
}
if (!source.includes('audioElement.__reachedPlaying = true;')) {
  throw new Error('Не отмечается момент первого воспроизведения');
}
if (!source.includes('canFallbackToNoWebAudio: processingWanted && !useHLS')) {
  throw new Error('Флаг аварийного перезапуска не выставляется при старте');
}

// Источники прошлых элементов отвязываются с задержкой кроссфейда,
// чтобы затухающая станция не обрывалась
if (!source.includes('const releaseDelay = useCrossfade ? crossfadeDuration + 500 : 0;')) {
  throw new Error('Источники старого элемента отвязываются без учёта кроссфейда');
}
if (!equalizer.includes('releaseSources(delayMs, keep)')) {
  throw new Error('В Equalizer нет отложенного отключения источников');
}
// В Chromium у MediaElementAudioSourceNode свойство mediaElement, а не media —
// без этого ползунок и fade «не видят», что элемент подключён к графу
if (!equalizer.includes('static mediaOf(node)') || !equalizer.includes('Equalizer.mediaOf(node) === audioElement')) {
  throw new Error('Привязка источника к элементу не учитывает mediaElement/media');
}

console.log('Equalizer/normalization guards: OK');
