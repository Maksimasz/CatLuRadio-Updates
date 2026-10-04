// Модуль эквалайзера и выравнивания громкости для радио-приложения.
//
// Цепочка обработки: источник (элемент <audio>) -> 10 полос эквалайзера ->
// компрессор выравнивания (нормализация) -> общий gain -> колонки.
//
// Каждый блок можно включать и выключать на лету (configure), обходя его,
// поэтому один экземпляр модуля обслуживает все станции подряд.
(function() {
  'use strict';

  // Частоты для полос эквалайзера (10 полос)
  const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  // Предустановки эквалайзера
  const EQ_PRESETS = {
    normal: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pop: [0, 0, 0, 2, 3, 3, 2, 0, 0, 0],
    rock: [4, 2, -2, -1, 1, 2, 3, 3, 2, 1],
    jazz: [2, 1, 0, 1, 2, 2, 1, 0, 1, 2],
    classic: [3, 2, 0, 0, 0, 0, 0, 2, 3, 3],
    bass: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0],
    treble: [0, 0, 0, 0, 0, 0, 2, 3, 4, 5],
    vocal: [-2, -1, 0, 2, 3, 3, 2, 0, -1, -2]
  };

  // Параметры выравнивания громкости (нормализация).
  // Низкий порог + большая крутизна прижимают громкие станции, а
  // makeup-усиление поднимает тихие: итог примерно соответствует
  // громкости, выставленной ползунком в плеере.
  const NORMALIZATION = {
    threshold: -24, // dB: ниже типичного уровня — обрабатываем почти всё
    knee: 30, // dB: мягкий переход у порога
    ratio: 12, // во сколько раз прижимаем то, что громче порога
    attack: 0.003, // сек: быстрая атака, не пропускаем всплески
    release: 0.25, // сек: плавная отдача
    makeupDb: 12 // dB: подъём общего уровня после компрессии
  };

  class Equalizer {
    constructor() {
      this.audioContext = null;
      this.sourceNodes = []; // MediaElementAudioSourceNode по одному на элемент
      this.gainNode = null;
      this.compressor = null;
      this.makeupGain = null;
      this.filters = [];
      this.useEqualizer = true;
      this.useNormalization = false;
      this.isEnabled = false;
      this.volume = 1; // Уровень gain графа (ползунок громкости плеера)
      this.values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // Значения по умолчанию
      this.currentPreset = 'normal';
    }

    // Создать узлы графа (один раз на жизнь страницы)
    _ensureNodes() {
      if (!this.gainNode) {
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1.0;
      }
      if (!this.compressor) {
        const compressor = this.audioContext.createDynamicsCompressor();
        compressor.threshold.value = NORMALIZATION.threshold;
        compressor.knee.value = NORMALIZATION.knee;
        compressor.ratio.value = NORMALIZATION.ratio;
        compressor.attack.value = NORMALIZATION.attack;
        compressor.release.value = NORMALIZATION.release;
        this.compressor = compressor;
      }
      if (!this.makeupGain) {
        this.makeupGain = this.audioContext.createGain();
        this.makeupGain.gain.value = Math.pow(10, NORMALIZATION.makeupDb / 20);
      }
      if (this.filters.length === 0) {
        this.filters = EQ_FREQUENCIES.map((freq, index) => {
          const filter = this.audioContext.createBiquadFilter();
          filter.type = 'peaking';
          filter.frequency.value = freq;
          filter.Q.value = 1.0;
          filter.gain.value = this.values[index];
          return filter;
        });
      }
    }

    // Медиаэлемент, привязанный к источнику (свойство называлось и media,
    // и mediaElement в разных версиях браузеров)
    static mediaOf(node) {
      return node.mediaElement || node.media || null;
    }

    // Инициализация: подключить элемент к графу обработки.
    // options.useEqualizer    — применять ли полосы эквалайзера
    // options.useNormalization — применять ли выравнивание громкости
    // options.releaseDelay     — через сколько мс отключить источники
    //                            прошлых элементов (кроссфейд: не рвем
    //                            затухающую станцию)
    init(audioElement, options = {}) {
      try {
        const {
          useEqualizer = true,
          useNormalization = false,
          releaseDelay = 0,
          volume = this.volume
        } = options;

        if (!this.audioContext) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          this.audioContext = new AudioContextClass();
        }
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
        this._bindGestureResume();

        this._ensureNodes();
        this.setVolume(volume);

        // Источник уже подключён? (повторный init того же элемента)
        let source = this.sourceNodes.find(node => Equalizer.mediaOf(node) === audioElement);
        // Отключаем источники прежних элементов сразу или через паузу кроссфейда
        this.releaseSources(releaseDelay, source);
        if (!source) {
          source = this.audioContext.createMediaElementSource(audioElement);
          this.sourceNodes.push(source);
        }

        this.useEqualizer = useEqualizer;
        this.useNormalization = useNormalization;
        this.rebuildGraph();
        this.isEnabled = true;
        return true;
      } catch (error) {
        console.error('Ошибка инициализации эквалайзера:', error);
        this.isEnabled = false;
        return false;
      }
    }

    // Переключить блоки обработки без переподключения элемента
    configure(options = {}) {
      if (options.useEqualizer !== undefined) this.useEqualizer = !!options.useEqualizer;
      if (options.useNormalization !== undefined) this.useNormalization = !!options.useNormalization;
      if (this.sourceNodes.length > 0) {
        this.rebuildGraph();
        this.isEnabled = true;
      }
    }

    // Пересобрать связи графа под текущие включенные блоки
    rebuildGraph() {
      if (!this.audioContext) return;

      // Отключить всё: источники и внутренние связи
      this.sourceNodes.forEach(node => { try { node.disconnect(); } catch (e) {} });
      this.filters.forEach(filter => { try { filter.disconnect(); } catch (e) {} });
      try { this.compressor.disconnect(); } catch (e) {}
      try { this.makeupGain.disconnect(); } catch (e) {}
      try { this.gainNode.disconnect(); } catch (e) {}

      // Хвост цепочки полос эквалайзера (или null, если EQ выключен)
      let eqTail = null;
      if (this.useEqualizer) {
        for (let i = 0; i < this.filters.length - 1; i++) {
          this.filters[i].connect(this.filters[i + 1]);
        }
        eqTail = this.filters[this.filters.length - 1];
      }

      if (this.useNormalization) {
        if (eqTail) eqTail.connect(this.compressor);
        this.compressor.connect(this.makeupGain);
        this.makeupGain.connect(this.gainNode);
      } else if (eqTail) {
        eqTail.connect(this.gainNode);
      }

      this.gainNode.connect(this.audioContext.destination);

      // Куда подключать источники (самый первый активный узел)
      let sourceTarget = this.gainNode;
      if (this.useEqualizer) sourceTarget = this.filters[0];
      else if (this.useNormalization) sourceTarget = this.compressor;
      this.sourceNodes.forEach(node => {
        try { node.connect(sourceTarget); } catch (e) {}
      });
    }

    // Отложить/выполнить отключение источников прежних элементов
    releaseSources(delayMs, keep) {
      const old = this.sourceNodes.filter(node => node !== keep);
      this.sourceNodes = this.sourceNodes.filter(node => node === keep);
      const drop = node => { try { node.disconnect(); } catch (e) {} };
      old.forEach(node => {
        if (delayMs > 0) setTimeout(() => drop(node), delayMs);
        else drop(node);
      });
    }

    // Задать уровень громкости графа (ползунок громкости плеера)
    setVolume(volume) {
      if (typeof volume === 'number' && isFinite(volume)) {
        this.volume = volume;
      }
      if (this.gainNode) {
        this.gainNode.gain.value = this.volume;
      }
    }

    // Подстраховка: AudioContext может стартовать в suspended без жеста —
    // резервируем его при первом клике/клавише пользователя
    _bindGestureResume() {
      if (this._gestureBound) return;
      this._gestureBound = true;
      const tryResume = () => {
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
      };
      document.addEventListener('pointerdown', tryResume, true);
      document.addEventListener('keydown', tryResume, true);
    }

    // Элемент уже подключён к графу?
    isAttachedTo(audioElement) {
      return !!audioElement && this.sourceNodes.some(node => Equalizer.mediaOf(node) === audioElement);
    }

    // Отключить источник конкретного элемента (например, при аварийном
    // перезапуске станции без Web Audio)
    releaseSourceFor(audioElement) {
      const index = this.sourceNodes.findIndex(node => Equalizer.mediaOf(node) === audioElement);
      if (index >= 0) {
        const [node] = this.sourceNodes.splice(index, 1);
        try { node.disconnect(); } catch (e) {}
      }
    }

    // Отключить эквалайзер полностью
    disconnect() {
      this.sourceNodes.forEach(node => { try { node.disconnect(); } catch (e) {} });
      this.sourceNodes = [];
      this.filters.forEach(filter => { try { filter.disconnect(); } catch (e) {} });
      if (this.gainNode) {
        try { this.gainNode.disconnect(); } catch (e) {}
      }
      this.isEnabled = false;
    }

    // Установить значение для полосы (от -12 до +12 дБ)
    setBandValue(bandIndex, value) {
      if (bandIndex < 0 || bandIndex >= this.values.length) {
        return;
      }

      value = Math.max(-12, Math.min(12, value));
      this.values[bandIndex] = value;

      if (this.filters[bandIndex]) {
        this.filters[bandIndex].gain.value = value;
      }
    }

    // Получить значение полосы
    getBandValue(bandIndex) {
      if (bandIndex < 0 || bandIndex >= this.values.length) {
        return 0;
      }
      return this.values[bandIndex];
    }

    // Установить предустановку
    setPreset(presetName) {
      if (!EQ_PRESETS[presetName]) {
        return;
      }

      this.currentPreset = presetName;
      const preset = EQ_PRESETS[presetName];

      preset.forEach((value, index) => {
        this.setBandValue(index, value);
      });
    }

    // Получить текущую предустановку
    getPreset() {
      return this.currentPreset;
    }

    // Сбросить все значения к нулям
    reset() {
      this.values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      this.filters.forEach((filter, index) => {
        filter.gain.value = 0;
      });
      this.currentPreset = 'normal';
    }

    // Получить все значения
    getValues() {
      return [...this.values];
    }

    // Установить все значения
    setValues(values) {
      if (!Array.isArray(values) || values.length !== 10) {
        return;
      }
      values.forEach((value, index) => {
        this.setBandValue(index, value);
      });
    }

    // Получить список предустановок
    static getPresets() {
      return Object.keys(EQ_PRESETS);
    }

    // Получить частоты полос
    static getFrequencies() {
      return [...EQ_FREQUENCIES];
    }
  }

  // Экспорт
  if (typeof window !== 'undefined') {
    window.Equalizer = Equalizer;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Equalizer;
  }
})();
