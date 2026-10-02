// Модуль эквалайзера для радио-приложения
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

  class Equalizer {
    constructor() {
      this.audioContext = null;
      this.sourceNode = null;
      this.gainNode = null;
      this.filters = [];
      this.isEnabled = false;
      this.values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // Значения по умолчанию
      this.currentPreset = 'normal';
    }

    // Инициализация эквалайзера
    init(audioElement) {
      try {
        // Создать AudioContext если еще не создан
        if (!this.audioContext) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          this.audioContext = new AudioContextClass();
        }

        // Если контекст приостановлен, возобновить его
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume();
        }

        // Отключить старый источник если есть
        if (this.sourceNode) {
          this.disconnect();
        }

        // Создать MediaElementSource из HTML Audio элемента
        this.sourceNode = this.audioContext.createMediaElementSource(audioElement);
        
        // Создать GainNode для общего усиления
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1.0;

        // Создать фильтры для каждой полосы
        this.filters = EQ_FREQUENCIES.map((freq, index) => {
          const filter = this.audioContext.createBiquadFilter();
          filter.type = 'peaking'; // Тип фильтра для эквалайзера
          filter.frequency.value = freq;
          filter.Q.value = 1.0; // Добротность
          filter.gain.value = this.values[index];
          return filter;
        });

        // Подключить цепочку: source -> filters -> gain -> destination
        let currentNode = this.sourceNode;
        this.filters.forEach(filter => {
          currentNode.connect(filter);
          currentNode = filter;
        });
        currentNode.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);

        this.isEnabled = true;
        return true;
      } catch (error) {
        console.error('Ошибка инициализации эквалайзера:', error);
        this.isEnabled = false;
        return false;
      }
    }

    // Отключить эквалайзер
    disconnect() {
      if (this.sourceNode) {
        try {
          this.sourceNode.disconnect();
        } catch (e) {
          // Игнорировать ошибки отключения
        }
        this.sourceNode = null;
      }
      
      this.filters.forEach(filter => {
        try {
          filter.disconnect();
        } catch (e) {
          // Игнорировать ошибки отключения
        }
      });
      
      if (this.gainNode) {
        try {
          this.gainNode.disconnect();
        } catch (e) {
          // Игнорировать ошибки отключения
        }
        this.gainNode = null;
      }

      this.isEnabled = false;
    }

    // Установить значение для полосы (от -12 до +12 дБ)
    setBandValue(bandIndex, value) {
      if (bandIndex < 0 || bandIndex >= this.values.length) {
        return;
      }

      // Ограничить значение от -12 до +12 дБ
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

    // Сбросить все значения к нулю
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

