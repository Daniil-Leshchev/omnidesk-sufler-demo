/*
 * Загрузчик для поля Omnidesk «Отображение внешних данных → Страница обращения» (U1).
 * 1. Грузит скрипт учёта времени - тот же адрес, что стоял в поле до загрузчика.
 * 2. После него (загрузился или нет) - демо «Подсказки ответа», и только в браузере
 *    с localStorage.csai_demo === '1'. У остальных сотрудников демо не скачивается.
 * Скрипты подключаются отдельными тегами: ошибка демо не трогает учёт времени.
 */
(function () {
  'use strict';

  var TIME_URL = 'https://cdn.jsdelivr.net/gh/Daniil-Leshchev/omnidesk-time-prob@d021886/omnidesk-time-track.js';
  // Пусто - демо берётся рядом с загрузчиком: тот же репозиторий и тот же коммит.
  var DEMO_URL = '';
  var DEMO_FILE = 'sufler-demo.js';
  var DEMO_WAIT_MS = 10000;

  var me = document.currentScript;
  var base = me && me.src ? me.src.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') : '';

  function addScript(src, done) {
    var s = document.createElement('script');
    var called = false;
    function finish(ok) {
      if (called) return;
      called = true;
      if (done) done(ok);
    }
    s.src = src;
    s.async = true;
    s.onload = function () { finish(true); };
    s.onerror = function () { finish(false); };
    (document.head || document.documentElement).appendChild(s);
    if (done) setTimeout(function () { finish(false); }, DEMO_WAIT_MS);
  }

  function demoOn() {
    try { return window.localStorage.getItem('csai_demo') === '1'; } catch (e) { return false; }
  }

  function loadDemo(timeOk) {
    if (!demoOn()) return;
    var url = DEMO_URL || (base ? base + DEMO_FILE : '');
    try {
      if (timeOk) console.info('[csai-loader] учёт времени загружен: ' + TIME_URL);
      else console.warn('[csai-loader] учёт времени не загрузился за ' + DEMO_WAIT_MS / 1000 + ' с или с ошибкой: ' + TIME_URL);
      if (url) console.info('[csai-loader] гружу демо: ' + url);
      else console.warn('[csai-loader] адрес демо не определён: document.currentScript пуст - задайте DEMO_URL в loader.js');
    } catch (e) { /* без консоли */ }
    if (!url) return;
    try {
      addScript(url, function (ok) {
        if (ok) return;
        try { console.warn('[csai-loader] демо не загрузилось (404, блокировка CSP или сеть): ' + url); } catch (e) { /* без консоли */ }
      });
    } catch (e) {
      try { console.warn('[csai-loader] не удалось подключить демо: ' + e.message); } catch (_) { /* без консоли */ }
    }
  }

  try {
    addScript(TIME_URL, loadDemo);
  } catch (e) {
    loadDemo(false);
  }
})();
