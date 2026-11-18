/*
 * «Подсказка ответа» (суфлёр ОА) - демо для страницы обращения Omnidesk U1.
 *
 * Включается только в браузере, где localStorage.csai_demo === '1'. У остальных сотрудников скрипт
 * сразу выходит: ничего не вставляет, не логирует, не заводит таймеров.
 *
 * Данные карточки тестовые и зашиты в файл. Сетевых запросов нет.
 * Со страницы читается только: переменная CurrentCaseId, разметка (где правая колонка, поле ответа
 * и кнопка «Отправить», по тегам, id, классам и подписям кнопок), содержимое поля ответа - чтобы
 * спросить «Заменить?» и «Вернуть как было», и в состоянии «Нет ID Умскул» - пусто ли поле «ID Умскул»
 * в «Данных пользователя». Содержимое полей не логируется и никуда не уходит.
 *
 * Настройки (localStorage):
 *   csai_demo = '1'                    - включить демо;
 *   csai_demo_layout = '2' | '1'       - карточка и полоса над полем ответа (по умолчанию) / кнопки в карточке, без полосы;
 *   csai_demo_send_cases = '[123,456]' - CurrentCaseId, где «Отправить» нажимает штатную кнопку;
 *   csai_demo_state = 'noid'           - начать с «Нет ID Умскул» и ждать, когда заполнят поле «ID Умскул».
 */
(function () {
  'use strict';

  var FLAG_KEY = 'csai_demo';

  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }

  if (lsGet(FLAG_KEY) !== '1') return;
  if (window.__csaiDemo && window.__csaiDemo.active) {
    try { console.warn('[csai-demo] уже запущен'); } catch (e) { /* без консоли */ }
    return;
  }

  try {
    start();
  } catch (e) {
    try { console.error('[csai-demo] не запустился', e); } catch (_) { /* без консоли */ }
  }

  function start() {
    const VERSION = '2026-11-18.6';
    const LAYOUT_KEY = 'csai_demo_layout';
    const SEND_KEY = 'csai_demo_send_cases';
    const STATE_KEY = 'csai_demo_state';
    const POLL_MS = 1000;
    const ID_POLL_MS = 3000;
    const REBUILD_MS = 1300;
    const FLOAT_AFTER_MS = 5000;
    const T0 = Date.now();
    const RM = (() => {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    })();

    /* ---------- тестовые данные карточки (как в макете sufler-mockups) ---------- */
    const MSG_TIME = '14:02';
    const SLOTS = 'Slots · 14:02';
    const PLAT = 'платформа · 14:02';
    const TOPIC = {name: 'Ссылка на занятие', sub: 'Математика · завтра', tpl: 'Ссылка на занятие', check: 'дата и время сверены'};
    const DRAFT = [
      'Здравствуйте, Анна! Занятие по ', {v: 'математике', what: 'Предмет занятия', src: SLOTS},
      ' завтра, ', {v: '19 ноября', what: 'Дата занятия', src: SLOTS},
      ', в ', {v: '18:00 МСК', what: 'Время занятия', src: SLOTS},
      '. Ссылку на подключение найдете в личном кабинете в расписании: ',
      {v: 'lk.umschool.one/schedule', what: 'Раздел ЛК «Расписание»', src: 'шаблон КС'},
      ' - там всегда актуальные ссылки. Если не получится подключиться - напишите, поможем.',
    ];
    const DRAFT_TEXT = DRAFT.map(p => (typeof p === 'string' ? p : p.v)).join('');
    // Вес ступени в карточке не показывается: только пункты ✓ и !, процент - их сумма.
    const CONF = [
      ['ok', 'тема определена однозначно', 35],
      ['ok', 'один вопрос', 20],
      ['ok', 'занятие найдено', 30],
      ['warn', 'на неделе 2 занятия - выбрано ближайшее', 0],
    ];
    const CONF_PCT = CONF.reduce((a, c) => a + c[2], 0);
    const FACTS = [
      {k: 'lesson', l: 'Занятие', v: 'Математика, чт 19.11, 18:00 МСК', m: SLOTS, url: 'https://platform.example/admin/lessons/5000001'},
      {k: 'prods', l: 'Продукты', v: '2 активных', m: PLAT, url: 'https://platform.example/admin/customers/1000001/products'},
      {k: 'freeze', l: 'Заморозка', v: 'нет', m: PLAT, url: 'https://platform.example/admin/customers/1000001/freezes'},
    ];
    const WHY = {
      lead: 'Клиент спрашивает ссылку на завтрашнее занятие по математике.',
      items: [
        ['Слова темы', '«ссылка», «урок» в сообщении 14:02'],
        ['Шаблон КС', '«Ссылка на занятие», вариант «одно занятие» - завтра у ученика одно занятие'],
        ['Факты', 'занятие - Slots · 14:02; ссылка - раздел ЛК «Расписание» из шаблона КС'],
      ],
    };
    const WHY_NOID = {
      lead: 'Тема понятна, но клиент не найден на платформе.',
      items: [
        ['Слова темы', '«ссылка», «урок» в сообщении 14:02'],
        ['Клиент', 'у контакта ВКонтакте нет ID Умскул - факты не загружены'],
      ],
    };
    const BAD = ['не та тема', 'неверный факт', 'устарело', 'не тот вариант шаблона', 'тон или длина', 'ответ не нужен'];

    /* ---------- состояние ---------- */
    const OPEN_DEFAULT = {conf: false, facts: false, why: false, fb: false, diag: false};
    const S = freshState();
    function freshState(keepDiag) {
      return {
        caseId: null, collapsed: false,
        open: Object.assign({}, OPEN_DEFAULT, {diag: !!keepDiag}),
        mode: 'ready', // ready | noid | rebuilding
        idBase: null, rebuildHow: '', clickedAt: 0, busy: false,
        phase: 'idle', // idle | confirm | inserting | inserted | sending | sent
        confirmFor: null, notice: null, prev: null, insertedFor: null,
        sent: null, bad: null, badOpen: false, flags: {}, tok: 0,
      };
    }
    function resetState() {
      const keep = S.open.diag;
      const tok = S.tok + 1;
      Object.assign(S, freshState(keep), {tok});
    }

    const R = {editor: null, send: null, composer: null, column: null, float: false, findAt: 0};
    const D = {
      started: hhmmss(), caseId: '-', caseSrc: '', layout: '', column: 'ещё не искали', editor: 'ещё не искали',
      send: 'ещё не искали', strip: '-', css: '-', redactor: '-', insert: '-', undo: '-', sendRes: '-',
      idField: 'не проверяется - нет csai_demo_state=noid', noidFlag: false,
      remounts: 0, remountTimes: [], pausedUntil: 0, csp: [], events: [],
    };

    /* ---------- журнал ---------- */
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function hhmmss(d) {
      d = d || new Date();
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }
    function hhmm(d) {
      d = d || new Date();
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    function log(msg) {
      D.events.push(hhmmss() + ' ' + msg);
      if (D.events.length > 40) D.events.shift();
      try { console.info('[csai-demo] ' + msg); } catch (e) { /* без консоли */ }
    }
    function warn(msg) {
      D.events.push(hhmmss() + ' ! ' + msg);
      if (D.events.length > 40) D.events.shift();
      try { console.warn('[csai-demo] ' + msg); } catch (e) { /* без консоли */ }
    }
    // Сбой пишется в консоль один раз, пока не изменится текст или пока не исправится: опрос раз в 1 с не спамит.
    const PROBLEMS = {};
    function problem(key, msg) {
      if (PROBLEMS[key] === msg) return;
      PROBLEMS[key] = msg;
      warn(msg);
    }
    function resolved(key, msg) {
      if (!PROBLEMS[key]) return;
      delete PROBLEMS[key];
      log(msg);
    }
    function safe(fn, label) {
      try { return fn(); } catch (e) {
        warn('ошибка в ' + label + ': ' + (e && e.message ? e.message : e));
        return undefined;
      }
    }

    /* ---------- настройки и обращение ---------- */
    function readLayout() {
      return String(lsGet(LAYOUT_KEY) || '2').trim() === '1' ? '1' : '2';
    }
    function wantStrip() { return D.layout === '2'; }
    function noidWanted() { return String(lsGet(STATE_KEY) || '').trim().toLowerCase() === 'noid'; }

    function readCaseVar() {
      let v;
      // Глобальная переменная Omnidesk может быть объявлена через let и не попасть в window.
      try { v = CurrentCaseId; } catch (e) { v = undefined; } // eslint-disable-line no-undef
      if (v === undefined || v === null || String(v) === '' || String(v) === '0') return null;
      return String(v);
    }
    function readCase() {
      const v = readCaseVar();
      if (v) return {id: v, src: 'CurrentCaseId'};
      const m = /\/cases\/record\/(\d+-\d+)/.exec(location.pathname + location.hash);
      if (m) return {id: 'url:' + m[1], src: 'адрес страницы'};
      return null;
    }
    function readSendList() {
      const raw = lsGet(SEND_KEY);
      if (!raw) return {list: [], err: ''};
      try {
        const v = JSON.parse(raw);
        if (!Array.isArray(v)) return {list: [], err: 'не JSON-массив'};
        return {list: v.map(x => String(x).trim()), err: ''};
      } catch (e) {
        return {list: [], err: 'не разбирается как JSON'};
      }
    }
    function sendAllowed() {
      const id = readCaseVar();
      const r = readSendList();
      if (!id) return {ok: false, why: 'нет CurrentCaseId на странице'};
      if (r.err) {
        problem('sendlist', SEND_KEY + ' ' + r.err + ' - отправка выключена во всех обращениях; нужен вид [123,456]');
        return {ok: false, why: SEND_KEY + ' ' + r.err};
      }
      resolved('sendlist', SEND_KEY + ' снова читается');
      if (r.list.indexOf(id) < 0) return {ok: false, why: 'обращения ' + id + ' нет в ' + SEND_KEY};
      return {ok: true, why: 'обращение ' + id + ' есть в ' + SEND_KEY};
    }

    /* ---------- DOM-помощники ---------- */
    const SVGNS = 'http://www.w3.org/2000/svg';
    const ICONS = {
      spark: [['path', {d: 'M7 1.8l1.45 3.75L12.2 7 8.45 8.45 7 12.2 5.55 8.45 1.8 7l3.75-1.45z', fill: 'currentColor', stroke: 'none'}],
        ['path', {d: 'M12.6 10.4l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z', fill: 'currentColor', stroke: 'none'}]],
      chevDown: [['path', {d: 'M4 6l4 4 4-4'}]],
      chevUp: [['path', {d: 'M4 10l4-4 4 4'}]],
      check: [['path', {d: 'M3.5 8.5l3 3 6-7'}]],
      warn: [['circle', {cx: 8, cy: 8, r: 6.2}], ['path', {d: 'M8 4.8v3.8M8 11v.2'}]],
      stop: [['circle', {cx: 8, cy: 8, r: 6.2}], ['path', {d: 'M3.6 3.6l8.8 8.8'}]],
      pencil: [['path', {d: 'M10.5 2.5l3 3L6 13H3v-3z'}]],
      undo: [['path', {d: 'M5 4L2.5 6.5 5 9'}], ['path', {d: 'M2.5 6.5H10a3.5 3.5 0 010 7H7'}]],
      send: [['path', {d: 'M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5z'}]],
      thumb: [['path', {d: 'M5.5 9.5V2.8M5.5 9.5l2.3 3.8c.9 0 1.5-.8 1.3-1.6L8.6 9.5h3.6a1.3 1.3 0 001.3-1.5l-.7-4a1.3 1.3 0 00-1.3-1.2H5.5M2.5 2.8h3v6.7h-3z'}]],
      flag: [['path', {d: 'M4 14V2.5'}], ['path', {class: 'fl', d: 'M4 3h7.5L9.7 5.8l1.8 2.7H4z'}]],
      idcard: [['rect', {x: 1.8, y: 3.2, width: 12.4, height: 9.6, rx: 1.5}], ['circle', {cx: 5.6, cy: 7.2, r: 1.4}],
        ['path', {d: 'M3.6 10.6c.4-1 1.1-1.5 2-1.5s1.6.5 2 1.5M9.5 6.6h3M9.5 9h2'}]],
      refresh: [['path', {d: 'M13 8a5 5 0 01-8.6 3.5M3 8a5 5 0 018.6-3.5'}], ['path', {d: 'M11.8 1.9v2.7H9.1M4.2 14.1v-2.7h2.7'}]],
      tool: [['circle', {cx: 8, cy: 8, r: 2.2}], ['path', {d: 'M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1'}]],
    };

    function h(tag, attrs) {
      const el = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(k => {
          const v = attrs[k];
          if (v === null || v === undefined || v === false) return;
          if (k === 'class') el.className = v;
          else el.setAttribute(k, v === true ? '' : String(v));
        });
      }
      for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
      return el;
    }
    function add(el, kid) {
      if (kid === null || kid === undefined || kid === false) return;
      if (Array.isArray(kid)) { kid.forEach(k => add(el, k)); return; }
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    function setKids(el, kids) {
      while (el.firstChild) el.removeChild(el.firstChild);
      add(el, kids);
    }
    function icon(name, cls) {
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('aria-hidden', 'true');
      (ICONS[name] || []).forEach(part => {
        const n = document.createElementNS(SVGNS, part[0]);
        Object.keys(part[1]).forEach(k => n.setAttribute(k, String(part[1][k])));
        svg.appendChild(n);
      });
      return svg;
    }
    function norm(s) { return String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }
    function plural(n, one, few, many) {
      const m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return one;
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
      return many;
    }
    function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

    /* ---------- поиск элементов страницы ---------- */
    function visible(el) {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    }
    function describe(el) {
      if (!el || !el.tagName) return '-';
      let s = el.tagName.toLowerCase();
      if (el.id) s += '#' + el.id;
      const raw = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
      const cls = raw.trim().split(/\s+/).filter(c => c && c.indexOf('csai') < 0).slice(0, 3);
      if (cls.length) s += '.' + cls.join('.');
      const name = el.getAttribute('name');
      if (name) s += '[name=' + name + ']';
      if (el.getAttribute('contenteditable') !== null && el.tagName !== 'TEXTAREA') s += '[contenteditable]';
      return s;
    }
    function ancestors(el) {
      const out = [];
      for (let n = el; n; n = n.parentElement) out.push(n);
      return out;
    }
    function treeDist(a, b) {
      const pb = new Map();
      ancestors(b).forEach((n, i) => pb.set(n, i));
      const pa = ancestors(a);
      for (let i = 0; i < pa.length; i++) if (pb.has(pa[i])) return i + pb.get(pa[i]);
      return 999;
    }
    function lca(a, b) {
      if (!a || !b) return null;
      const pb = new Set(ancestors(b));
      for (let n = a; n; n = n.parentElement) if (pb.has(n)) return n;
      return null;
    }
    function isDisabled(el) {
      if (!el) return true;
      if (el.disabled) return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;
      const cls = typeof el.className === 'string' ? el.className : '';
      return /(^|\s)(disabled|is-disabled|btn-disabled)(\s|$)/i.test(cls);
    }
    function ownText(el) {
      let t = '';
      for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue;
      return norm(t);
    }
    function labelOf(el) {
      if (el.tagName === 'INPUT') return norm(el.value);
      return norm(el.textContent);
    }
    function findHeading(re) {
      if (!document.body) return null;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n, i = 0;
      while ((n = w.nextNode()) && i++ < 30000) {
        const t = n.nodeValue;
        if (!t || t.length > 60) continue;
        if (!re.test(t.trim())) continue;
        const el = n.parentElement;
        if (el && visible(el)) return el;
      }
      return null;
    }
    function blockAncestor(el) {
      let n = el;
      while (n.parentElement && n.parentElement !== document.body) {
        const d = getComputedStyle(n).display;
        const p = getComputedStyle(n.parentElement);
        const parentRow = /flex/.test(p.display) && !/column/.test(p.flexDirection);
        if (!/^inline/.test(d) && d !== 'contents' && !parentRow) return n;
        n = n.parentElement;
      }
      return n;
    }

    const COLUMN_SELECTORS = ['#info_user_info_panel'];
    function findColumn() {
      for (const sel of COLUMN_SELECTORS) {
        const el = document.querySelector(sel);
        if (el) {
          return {parent: el, before: el.firstChild, how: sel + ' - вставка первым элементом', el,
            visible: visible(el)};
        }
      }
      const head = findHeading(/^данные пользователя$/i);
      if (head) {
        const blk = blockAncestor(head);
        return {parent: blk.parentNode, before: blk, how: 'по заголовку «Данные пользователя» - над ' + describe(blk),
          el: blk, visible: visible(blk)};
      }
      return null;
    }

    const SEND_RE = /^отправить(\s*\(.{0,24}\))?$/i;
    const FS = {hidden: 0, hiddenEls: [], similar: []};
    function noteSimilar(t) {
      if (/отправ/i.test(t) && FS.similar.length < 4 && FS.similar.indexOf(t) < 0) FS.similar.push(t);
    }
    function findSendButtons() {
      FS.hidden = 0;
      FS.hiddenEls = [];
      FS.similar = [];
      const out = [];
      const nodes = document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"]');
      for (let i = 0; i < nodes.length && i < 6000; i++) {
        const el = nodes[i];
        const t = labelOf(el);
        if (t.length > 40) continue;
        // Похожие подписи - только у кнопок: в ссылках и тексте ленты бывают слова клиента.
        if (!SEND_RE.test(t)) { if (el.tagName !== 'A') noteSimilar(t); continue; }
        if (!visible(el)) { FS.hidden++; FS.hiddenEls.push({el, how: 'по подписи «' + t + '»'}); continue; }
        out.push({el, how: 'по подписи «' + t + '»'});
      }
      if (out.length) return out;
      const more = document.querySelectorAll('span, div, label');
      for (let i = 0; i < more.length && i < 15000; i++) {
        const el = more[i];
        const t = ownText(el);
        if (!t || t.length > 40 || !SEND_RE.test(t)) continue;
        if (!visible(el)) {
          FS.hidden++;
          FS.hiddenEls.push({el: el.closest('button, a, [role="button"], [onclick]') || el, how: 'по подписи «' + t + '» у ' + el.tagName.toLowerCase()});
          continue;
        }
        const target = el.closest('button, a, [role="button"], [onclick]') || el;
        out.push({el: target, how: 'по подписи «' + t + '» у ' + el.tagName.toLowerCase()});
      }
      return out;
    }
    function sendStats() {
      return 'видимой кнопки с подписью «Отправить» нет'
        + (FS.hidden ? '; скрытых с такой подписью ' + FS.hidden : '')
        + (FS.similar.length ? '; похожие подписи кнопок: «' + FS.similar.join('», «') + '»' : '; похожих подписей у кнопок нет')
        + '; искали button, a, input, [role=button], затем span, div, label';
    }
    const EDITOR_KNOWN = '.redactor-in, .redactor-editor, .redactor_editor, .redactor-layer, .ql-editor, .ProseMirror, .note-editable, .fr-element';
    const FE = {total: 0, readonly: 0, nested: 0, hidden: 0, panel: 0, narrow: 0, source: 0, sources: []};
    const CE_SEL = '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';
    // Визуальный редактор (Redactor и т.п.) держит текст в textarea рядом с собой. Писать надо в видимый
    // contenteditable: обратно из textarea редактор текст не забирает и при отправке перезапишет его.
    function nearVisibleCe(ta) {
      let p = ta.parentElement;
      for (let i = 0; p && i < 3; i++, p = p.parentElement) {
        const ces = p.querySelectorAll(CE_SEL);
        for (let j = 0; j < ces.length; j++) {
          const ce = ces[j];
          if (!ce.closest('#info_user_info_panel') && visible(ce) && ce.getBoundingClientRect().width >= 120) return ce;
        }
      }
      return null;
    }
    // Видна ли textarea на самом деле: в её центре на экране - она сама, а не то, что её закрывает или обрезает.
    function hitTestable(el) {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 20);
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    }
    function isEditorStore(ta) {
      return !ta.closest('#info_user_info_panel') && !hitTestable(ta) && !!nearVisibleCe(ta);
    }
    function findEditors() {
      Object.keys(FE).forEach(k => { FE[k] = k === 'sources' ? [] : 0; });
      const out = [];
      const nodes = document.querySelectorAll('textarea, ' + CE_SEL);
      FE.total = nodes.length;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (el.tagName === 'TEXTAREA' && isEditorStore(el)) { FE.source++; FE.sources.push(describe(el)); continue; }
        if (el.readOnly || el.disabled) { FE.readonly++; continue; }
        if (el.tagName !== 'TEXTAREA' && el.parentElement && el.parentElement.closest('[contenteditable="true"], [contenteditable=""]')) { FE.nested++; continue; }
        if (!visible(el)) { FE.hidden++; continue; }
        if (el.closest('#info_user_info_panel')) { FE.panel++; continue; }
        const r = el.getBoundingClientRect();
        if (r.width < 120) { FE.narrow++; continue; }
        let score = 0;
        const why = [];
        if (el.matches(EDITOR_KNOWN)) { score += 3; why.push('известный класс редактора'); }
        const ph = norm((el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('data-placeholder') || '') + ' ' + (el.getAttribute('aria-label') || ''));
        if (/ответ|сообщени|написать/i.test(ph)) { score += 2; why.push('подсказка «ответ»'); }
        out.push({el, kind: el.tagName === 'TEXTAREA' ? 'textarea' : 'ce', score, area: r.width * r.height,
          how: (el.tagName === 'TEXTAREA' ? 'textarea' : 'contenteditable') + (why.length ? ', ' + why.join(', ') : '')});
      }
      return out;
    }
    function editorStats() {
      return 'textarea и contenteditable на странице ' + FE.total
        + (FE.total ? ': скрытых ' + FE.hidden + ', только чтение ' + FE.readonly + ', в правой колонке ' + FE.panel
          + ', уже 120 px ' + FE.narrow + ', вложенных ' + FE.nested + ', хранилищ визуального редактора ' + FE.source : '');
    }
    function composerOf(editorEl, sendEl) {
      const edH = editorEl.getBoundingClientRect().height;
      let box = sendEl ? lca(editorEl, sendEl) : null;
      const tooBig = b => !b || b === document.body || b === document.documentElement
        || b.getBoundingClientRect().height > Math.max(edH + 160, 260);
      if (tooBig(box)) {
        box = editorEl;
        while (box.parentElement && box.parentElement !== document.body) {
          if (box.parentElement.getBoundingClientRect().height > edH + 120) break;
          box = box.parentElement;
        }
      }
      return box;
    }

    function refindReply(force) {
      if (!force && Date.now() - R.findAt < 800) return;
      R.findAt = Date.now();
      const sends = findSendButtons();
      const eds = findEditors();
      let best = null;
      if (sends.length && eds.length) {
        sends.forEach(s => eds.forEach(e => {
          const d = treeDist(s.el, e.el) - e.score;
          if (!best || d < best.d) best = {d, send: s, editor: e};
        }));
      } else if (eds.length) {
        eds.sort((a, b) => (b.score - a.score) || (b.area - a.area));
        best = {editor: eds[0], send: null};
      } else if (sends.length) {
        best = {editor: null, send: sends[0]};
      }
      const prevEd = R.editor && R.editor.el;
      const prevSend = R.send && R.send.el;
      R.editor = upgradeEditor(best ? best.editor : null);
      R.send = best ? best.send : null;
      // Omnidesk показывает «ОТПРАВИТЬ» только когда в поле есть текст: до вставки берём скрытую кнопку, ближайшую к полю.
      if (!R.send && FS.hiddenEls.length) {
        const near = R.editor ? FS.hiddenEls.slice().sort((a, b) => treeDist(a.el, R.editor.el) - treeDist(b.el, R.editor.el))[0] : FS.hiddenEls[0];
        R.send = {el: near.el, how: near.how, hidden: true};
      }
      R.composer = R.editor ? composerOf(R.editor.el, R.send && R.send.el) : null;
      if (R.editor) {
        const src = edSource(R.editor);
        D.editor = 'найден: ' + describe(R.editor.el) + ' (' + R.editor.how + ')'
          + (src ? '; хранилище ' + describe(src) : '') + (eds.length > 1 ? '; кандидатов ' + eds.length : '')
          + (FE.sources.length ? '; не трогаю скрытые textarea рядом: ' + FE.sources.slice(0, 2).join(', ') : '');
      } else {
        D.editor = 'не найден: ' + editorStats();
      }
      if (R.send && R.send.hidden) {
        D.send = 'найдена, сейчас скрыта: ' + describe(R.send.el) + ' ' + R.send.how + ' - Omnidesk покажет её, когда в поле будет текст';
      } else if (R.send) {
        D.send = 'найдена: ' + describe(R.send.el) + ' ' + R.send.how + (isDisabled(R.send.el) ? ', сейчас неактивна' : ', активна')
          + (sends.length > 1 ? '; кандидатов ' + sends.length : '');
      } else {
        D.send = 'не найдена: ' + sendStats();
      }
      const libs = ['$R', 'RedactorX', 'Redactor', 'tinymce', 'CKEDITOR', 'Jodit', 'Quill', 'FroalaEditor', 'Trumbowyg']
        .filter(n => { try { return typeof window[n] !== 'undefined'; } catch (e) { return false; } });
      if (window.jQuery && window.jQuery.fn && window.jQuery.fn.redactor) libs.push('jQuery.fn.redactor');
      const omni = R.editor ? omniEditor(R.editor) : null;
      D.redactor = (omni ? 'Omnidesk: редактор «' + omni.id + '» в RedactorManager, вставка через '
        + (typeof window.InsertRedactorHtml === 'function' ? 'InsertRedactorHtml' : 'editor.setContent')
        : 'RedactorManager Omnidesk не найден - вставка имитацией ввода')
        + (libs.length ? ' · есть: ' + libs.join(', ') : '');
      if ((R.editor && R.editor.el) !== prevEd || (R.send && R.send.el) !== prevSend) {
        log('поле ответа: ' + (R.editor ? describe(R.editor.el) : 'нет') + ' · кнопка: ' + (R.send ? describe(R.send.el) : 'нет'));
      }
      if (R.editor) resolved('editor', 'поле ответа найдено: ' + describe(R.editor.el));
      else problem('editor', 'поле ответа не найдено - ' + editorStats());
      if (R.send) resolved('send', 'кнопка «Отправить» найдена: ' + describe(R.send.el));
      else problem('send', 'кнопка «Отправить» не найдена - ' + sendStats());
      if (R.editor && R.send && best && best.d > 12) {
        problem('pair', 'поле ответа и кнопка «Отправить» далеко друг от друга в разметке (' + best.d + ' шагов) - возможно, выбраны не те элементы');
      } else {
        resolved('pair', 'поле ответа и кнопка «Отправить» рядом в разметке');
      }
    }
    // Redactor Omnidesk создаётся после загрузки страницы: textarea, найденная при старте, потом становится его хранилищем.
    // Если у textarea есть редактор Omnidesk или рядом появилось видимое поле - работаем с видимым полем.
    function omniNodeFor(id) {
      const eds = id && window.RedactorManager && window.RedactorManager.editors;
      const e = eds && eds[id];
      let node = null;
      try { node = e && typeof e.getEditor === 'function' ? e.getEditor() : null; } catch (err) { node = null; }
      if (node && node.nodeType !== 1 && typeof node.get === 'function') node = node.get();
      return node && node.nodeType === 1 && visible(node) ? node : null;
    }
    function upgradeEditor(cand) {
      if (!cand || cand.kind !== 'textarea') return cand;
      const node = omniNodeFor(cand.el.id);
      if (node) return {el: node, kind: 'ce', score: cand.score, area: cand.area, how: 'редактор Omnidesk для textarea#' + cand.el.id};
      if (isEditorStore(cand.el)) {
        const ce = nearVisibleCe(cand.el);
        if (ce) return {el: ce, kind: 'ce', score: cand.score, area: cand.area, how: 'видимое поле рядом с ' + describe(cand.el)};
      }
      return cand;
    }
    function editorStale() {
      const ed = R.editor;
      if (!ed || !ed.el.isConnected) return true;
      return ed.kind === 'textarea' && (!!omniNodeFor(ed.el.id) || isEditorStore(ed.el));
    }
    function liveEditor() {
      if (editorStale()) refindReply(true);
      return R.editor;
    }
    function liveSend() {
      if (!R.send || R.send.hidden || !R.send.el.isConnected || !visible(R.send.el)) refindReply(true);
      return R.send;
    }

    /* ---------- поле ответа: чтение и запись ---------- */
    function edRead(ed) {
      if (!ed || !ed.el) return '';
      return ed.kind === 'ce' ? (ed.el.innerText || '') : (ed.el.value || '');
    }
    // id редактора Omnidesk (= id его textarea-хранилища) по видимому полю.
    function omniIdFor(el) {
      const eds = window.RedactorManager && window.RedactorManager.editors;
      if (!eds || !el) return null;
      let id = null;
      Object.keys(eds).some(k => {
        let node = null;
        try { node = eds[k] && typeof eds[k].getEditor === 'function' ? eds[k].getEditor() : null; } catch (e) { node = null; }
        if (node && node.nodeType !== 1 && typeof node.get === 'function') node = node.get();
        if (node && node.nodeType === 1 && (node === el || node.contains(el))) { id = k; return true; }
        return false;
      });
      return id;
    }
    // Хранилище видимого поля. rx-source-textarea - служебное поле Redactor для режима «HTML-код»,
    // оно обновляется только при переключении в этот режим, поэтому хранилищем не считается.
    function edSource(ed) {
      if (!ed || ed.kind !== 'ce') return null;
      const oid = omniIdFor(ed.el);
      const own = oid ? document.getElementById(oid) : null;
      if (own && own.tagName === 'TEXTAREA') return own;
      let p = ed.el.parentElement;
      for (let i = 0; p && i < 5; i++, p = p.parentElement) {
        const tas = Array.prototype.filter.call(p.querySelectorAll('textarea'),
          t => !t.closest('#info_user_info_panel') && !t.classList.contains('rx-source-textarea'));
        if (!tas.length) continue;
        return tas.find(t => /response|content|reply|message|body/i.test(t.id + ' ' + t.name))
          || tas.find(t => /wysiwyg|redactor/i.test(t.className)) || tas[0];
      }
      return null;
    }
    function nativeSet(el, v) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(el, v);
      else el.value = v;
    }
    function fire(el, type) {
      let ev;
      try {
        ev = type === 'input' ? new InputEvent('input', {bubbles: true, inputType: 'insertText'}) : new Event(type, {bubbles: true});
      } catch (e) {
        ev = document.createEvent('Event');
        ev.initEvent(type, true, true);
      }
      el.dispatchEvent(ev);
    }
    function fireKeyup(el) {
      try { el.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true, key: 'End', code: 'End'})); } catch (e) { /* старый браузер */ }
    }
    function focusEl(el) {
      try { el.focus({preventScroll: true}); } catch (e) { el.focus(); }
    }
    function caretToEnd(ed) {
      const omni = omniEditor(ed);
      if (omni && typeof omni.editor.focusEditor === 'function') {
        try { omni.editor.focusEditor({position: 'end'}); return; } catch (e) { /* ниже обычный путь */ }
      }
      try {
        if (ed.kind === 'ce') {
          const r = document.createRange();
          r.selectNodeContents(ed.el);
          r.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } else {
          const n = ed.el.value.length;
          ed.el.setSelectionRange(n, n);
        }
      } catch (e) { /* не критично */ }
    }
    const STABLE_MS = 600;
    const escHtml = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
    // Omnidesk держит редакторы ответа (Redactor 4) в RedactorManager.editors по id textarea-хранилища и вставляет
    // шаблоны через InsertRedactorHtml(id, html, withPre, clearPrevHtml). Этим путём редактор текст точно видит.
    // SetRedactorCode не подходит: дописывает к тому, что уже есть в поле.
    function omniEditor(ed) {
      try {
        const eds = ed && ed.kind === 'ce' && window.RedactorManager && window.RedactorManager.editors;
        if (!eds) return null;
        let id = omniIdFor(ed.el);
        if (!id) {
          const src = edSource(ed);
          if (src && src.id && eds[src.id]) id = src.id;
        }
        const editor = id ? eds[id] : null;
        return editor && typeof editor.setContent === 'function' ? {id, editor} : null;
      } catch (e) {
        return null;
      }
    }
    function omniSet(o, html) {
      if (typeof window.InsertRedactorHtml === 'function') {
        window.InsertRedactorHtml(o.id, html, true, true);
        return 'InsertRedactorHtml';
      }
      o.editor.setContent(html);
      return 'editor.setContent';
    }
    function omniHtml(o) {
      try {
        if (typeof window.GetRedactorHtml === 'function') return window.GetRedactorHtml(o.editor);
        return o.editor.getContent('html', {tidy: false});
      } catch (e) {
        return null;
      }
    }
    // Кадр отрисовки или 50 мс, что раньше: в фоновой вкладке requestAnimationFrame не приходит.
    function nextFrame() {
      return new Promise(res => {
        let done = false;
        const fin = () => { if (!done) { done = true; res(); } };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fin);
        setTimeout(fin, 50);
      });
    }
    function deepActive() {
      let a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      return a;
    }
    function hasFocusIn(el) {
      const a = document.activeElement;
      return !!a && (a === el || el.contains(a));
    }
    // Как клик менеджера в поле: часть редакторов включается только от мыши и фокуса, одного focus() им мало.
    // Фокус с нашей кнопки внутри Shadow DOM снимаем, иначе Safari может оставить выделение у нас.
    async function activateEditor(el) {
      try {
        const own = deepActive();
        if (own && own !== el && own.getRootNode && own.getRootNode() !== document && typeof own.blur === 'function') own.blur();
      } catch (e) { /* не критично */ }
      const r = el.getBoundingClientRect();
      const opts = {bubbles: true, cancelable: true, composed: true, view: window, button: 0,
        clientX: r.left + Math.min(24, r.width / 2), clientY: r.top + Math.min(16, r.height / 2)};
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
        try {
          const Ctor = t.indexOf('pointer') === 0 && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
          el.dispatchEvent(new Ctor(t, opts));
        } catch (e) { /* старый браузер */ }
      });
      focusEl(el);
      await nextFrame();
      await nextFrame();
      return hasFocusIn(el);
    }
    function selectAllIn(el) {
      try {
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e) { /* ниже проверка покажет */ }
    }
    // Вставка «как из буфера обмена»: визуальные редакторы обрабатывают paste сами и кладут текст в свою модель.
    function pasteInto(el, text) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        const ev = new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true, composed: true});
        if (!ev.clipboardData || ev.clipboardData.getData('text/plain') !== text) return 'paste: браузер не передал буфер';
        el.dispatchEvent(ev);
        return ev.defaultPrevented ? 'paste: редактор обработал' : 'paste: редактор не обработал';
      } catch (e) {
        return 'paste: не создалось (' + e.message + ')';
      }
    }
    function ceHas(el, text) { return norm(el.innerText) === norm(text); }
    function srcHas(src, text) {
      const plain = norm(String(src.value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' '));
      return text ? plain.indexOf(norm(text).slice(0, 40)) >= 0 : plain === '';
    }
    // text - что должно оказаться в поле; html - для «Вернуть как было» у contenteditable.
    // ok - текст в поле и через STABLE_MS не откатился, а хранилище редактора (если есть) его тоже получило.
    async function edWrite(ed, text, html) {
      const el = ed.el;
      const steps = [];
      const res = {ok: false, steps, srcNote: '', focus: '', hint: ''};
      if (ed.kind !== 'ce') {
        focusEl(el);
        try {
          el.select();
          const ok = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text);
          if (ok && el.value === text) steps.push('execCommand ' + (text === '' ? 'delete' : 'insertText'));
        } catch (e) { /* ниже запасной путь */ }
        if (el.value !== text) {
          nativeSet(el, text);
          fire(el, 'input');
          steps.push('value + событие input');
        }
        fire(el, 'change');
        fireKeyup(el);
        await sleep(STABLE_MS);
        res.ok = el.isConnected && el.value === text;
        if (!res.ok) { steps.push('через ' + STABLE_MS + ' мс текста в поле нет ✗'); res.hint = 'Поставьте курсор в поле ответа и нажмите кнопку ещё раз.'; }
        return res;
      }
      const useHtml = html !== undefined && html !== null;
      let stays = false;
      let focused = true;
      const omni = omniEditor(ed);
      if (omni) {
        try {
          steps.push('Omnidesk ' + omniSet(omni, useHtml ? (html || '') : (text ? '<p>' + escHtml(text) + '</p>' : '')) + '(«' + omni.id + '»)');
          res.focus = 'через функцию Omnidesk';
          await sleep(STABLE_MS / 2);
          if (!ceHas(el, text)) steps.push('текста нет');
          else {
            await sleep(STABLE_MS / 2);
            if (ceHas(el, text) && el.isConnected) stays = true;
            else steps.push('редактор откатил');
          }
        } catch (e) {
          steps.push('Omnidesk: ' + e.message);
        }
      }
      if (!stays) {
        focused = await activateEditor(el);
        res.focus = (omni ? 'функция Omnidesk не помогла, ' : '') + (focused ? 'фокус в поле' : 'фокус не встал (' + describe(deepActive()) + ')');
      }
      // Способы по очереди: после каждого ждём - редактор может откатить чужую правку не сразу.
      const methods = [
        ['execCommand', () => {
          try {
            let ok;
            if (useHtml) ok = document.execCommand('insertHTML', false, html || '');
            else if (text === '') ok = document.execCommand('delete');
            else ok = document.execCommand('insertText', false, text);
            return 'execCommand ' + (useHtml ? 'insertHTML' : (text === '' ? 'delete' : 'insertText')) + (ok ? '' : ' вернул false');
          } catch (e) { return 'execCommand: ' + e.message; }
        }],
        ['paste', () => pasteInto(el, text)],
        ['dom', () => {
          try {
            if (useHtml) el.innerHTML = html;
            else el.textContent = text;
            fire(el, 'input');
            return 'запись в DOM + input';
          } catch (e) { return 'запись в DOM: ' + e.message; }
        }],
      ];
      for (let m = 0; m < methods.length && !stays; m++) {
        if (methods[m][0] === 'paste' && text === '') continue;
        if (m > 0) { focusEl(el); await nextFrame(); }
        selectAllIn(el);
        steps.push(methods[m][1]());
        fire(el, 'change');
        fireKeyup(el);
        await sleep(STABLE_MS / 2);
        if (!ceHas(el, text)) { steps.push('текста нет'); continue; }
        await sleep(STABLE_MS / 2);
        if (ceHas(el, text) && el.isConnected) stays = true;
        else steps.push('редактор откатил');
      }
      if (!stays) steps.push('текст не удержался ✗');
      const src = edSource(ed);
      let srcOk = true;
      if (src) {
        srcOk = srcHas(src, text);
        if (!srcOk) { await sleep(STABLE_MS); srcOk = srcHas(src, text); }
        res.srcNote = (srcOk ? 'хранилище ' + describe(src) + ' обновилось ✓' : 'хранилище ' + describe(src) + ' не обновилось');
        if (!srcOk && omni) {
          const h = omniHtml(omni);
          srcOk = h !== null && srcHas({value: h}, text);
          res.srcNote += srcOk ? ', но в редакторе Omnidesk текст есть ✓' : ' ✗';
        } else if (!srcOk) {
          res.srcNote += ' ✗';
        }
      }
      res.ok = stays && srcOk;
      if (!res.ok) {
        res.hint = 'Поставьте курсор в поле ответа и нажмите кнопку ещё раз' + (focused ? '.' : ' - фокус в поле не встал.');
      }
      return res;
    }
    function hasForeignText(ed) {
      const t = norm(edRead(ed));
      return t !== '' && t !== norm(DRAFT_TEXT);
    }
    function snapshot(ed) {
      const omni = omniEditor(ed);
      const omniH = omni ? omniHtml(omni) : null;
      return {kind: ed.kind, text: edRead(ed), html: ed.kind === 'ce' ? (omniH !== null ? omniH : ed.el.innerHTML) : null};
    }
    function editorEmptyNow() {
      const ed = liveEditor();
      if (!ed) return true;
      return norm(edRead(ed)) === '';
    }

    /* ---------- действия ---------- */
    function needEditor() {
      refindReply(true);
      const ed = liveEditor();
      if (!ed) {
        S.notice = {cls: 'bad', title: 'Поле ответа не найдено', text: 'Текст не вставлен. Подробности - в «Диагностике».'};
        warn('действие отменено: поле ответа не найдено - ' + editorStats());
        render();
      }
      return ed;
    }
    async function doInsert(ed, label) {
      if (S.phase !== 'inserted' || !S.prev) S.prev = snapshot(ed);
      const sendBtn = R.send && R.send.el;
      const wasDisabled = sendBtn ? isDisabled(sendBtn) || !visible(sendBtn) : null;
      const insertAt = Date.now();
      const r = await edWrite(ed, DRAFT_TEXT);
      D.insert = hhmmss() + ' · ' + label + ' · ' + describe(ed.el) + (r.focus ? ' · ' + r.focus : '') + ' · ' + (r.steps.join(' → ') || 'без шагов')
        + ' · ' + (r.ok ? 'поле видит текст ✓ (' + norm(edRead(ed)).length + ' знаков)' : 'текст в поле не принят ✗')
        + (r.srcNote ? ' · ' + r.srcNote : '');
      if (r.ok) {
        log('вставка (' + label + '): ок, ' + (r.focus ? r.focus + ', ' : '') + 'способ: ' + r.steps.join(' → '));
      } else {
        warn('вставка (' + label + ') не принята редактором: ожидалось ' + norm(DRAFT_TEXT).length + ' знаков, в поле '
          + norm(edRead(ed)).length + '; поле ' + describe(ed.el) + (r.focus ? '; ' + r.focus : '') + '; шаги: ' + (r.steps.join(' → ') || 'нет')
          + (r.srcNote ? '; ' + r.srcNote : ''));
      }
      if (!ed.el.isConnected) warn('поле ответа ' + describe(ed.el) + ' пропало со страницы во время вставки');
      if (r.ok && sendBtn && wasDisabled) {
        setTimeout(() => {
          // Скрипт уже нажал «Отправить» или черновика в поле уже нет - состояние кнопки ни о чём не говорит.
          if (S.clickedAt >= insertAt || !ed.el.isConnected || norm(edRead(ed)) !== norm(DRAFT_TEXT)) return;
          let b = sendBtn;
          if (!b.isConnected || !visible(b)) { refindReply(true); if (R.send && !R.send.hidden) b = R.send.el; }
          const now = !b.isConnected || !visible(b) || isDisabled(b);
          D.insert += now ? ' · кнопка «Отправить» осталась скрытой или неактивной ✗' : ' · кнопка «Отправить» появилась и активна ✓';
          if (now) warn('после вставки кнопка «Отправить» ' + describe(b) + ' осталась скрытой или неактивной - редактор, похоже, не увидел текст');
          renderDiag();
        }, 300);
      }
      return r;
    }
    function failedInsert(ed, r) {
      S.notice = {cls: 'bad', title: 'Редактор не принял текст', text: r.hint || 'Подробности - в «Диагностике».'};
      S.phase = norm(edRead(ed)) && norm(edRead(ed)) !== norm(S.prev ? S.prev.text : '') ? 'inserted' : 'idle';
      S.insertedFor = MSG_TIME;
    }

    async function actEdit(force) {
      if (S.mode !== 'ready' || S.busy || S.phase === 'sending' || S.phase === 'sent') return;
      S.notice = null;
      const ed = needEditor();
      if (!ed) return;
      if (!force && S.phase !== 'inserted' && hasForeignText(ed)) {
        S.phase = 'confirm';
        S.confirmFor = 'edit';
        render();
        return;
      }
      const tok = S.tok;
      S.busy = true;
      S.confirmFor = null;
      S.phase = 'inserting';
      render();
      let r;
      try { r = await doInsert(ed, '«Изменить»'); } finally { S.busy = false; }
      if (tok !== S.tok) return;
      if (!r.ok) {
        failedInsert(ed, r);
        render();
        return;
      }
      S.phase = 'inserted';
      S.insertedFor = MSG_TIME;
      caretToEnd(ed);
      render();
    }

    async function actSend(force) {
      if (S.mode !== 'ready' || S.busy || S.phase === 'sending' || S.phase === 'sent') return;
      S.notice = null;
      const tok = S.tok;
      const ed = needEditor();
      if (!ed) return;
      if (!force && hasForeignText(ed)) {
        S.phase = 'confirm';
        S.confirmFor = 'send';
        render();
        return;
      }
      S.confirmFor = null;
      const allowed = sendAllowed();
      S.busy = true;
      S.phase = 'inserting';
      render();
      let ins;
      try { ins = await doInsert(ed, '«Отправить»'); } finally { S.busy = false; }
      if (tok !== S.tok) return;
      if (!ins.ok) {
        failedInsert(ed, ins);
        S.notice.title = 'Редактор не принял текст - отправку не нажимаю';
        D.sendRes = hhmmss() + ' · не нажата: редактор не принял вставленный текст';
        warn('«Отправить»: штатную кнопку не нажимаю - редактор не принял вставленный текст');
        render();
        return;
      }
      if (!allowed.ok) {
        S.phase = 'inserted';
        S.insertedFor = MSG_TIME;
        S.notice = {cls: 'warn', title: 'Отправка выключена для этого обращения',
          text: 'Текст только вставлен. Проверьте и отправьте сами кнопкой Omnidesk.'};
        D.sendRes = hhmmss() + ' · не нажата: ' + allowed.why;
        log('отправка выключена: ' + allowed.why);
        caretToEnd(ed);
        render();
        return;
      }
      S.phase = 'sending';
      render();
      await sleep(250);
      if (tok !== S.tok) return;
      let btn = null;
      for (let i = 0; i < 15; i++) {
        const s = liveSend();
        if (s && !s.hidden && visible(s.el) && !isDisabled(s.el)) { btn = s; break; }
        await sleep(100);
        if (tok !== S.tok) return;
      }
      if (!btn) {
        const s = R.send;
        const why = !s ? 'не найдена' : (s.hidden || !visible(s.el) ? 'не появилась' : 'неактивна');
        S.phase = 'inserted';
        S.insertedFor = MSG_TIME;
        S.notice = {cls: 'warn', title: 'Кнопка «Отправить» ' + why, text: 'Текст вставлен. Отправьте сами кнопкой Omnidesk.'};
        D.sendRes = hhmmss() + ' · не нажата: ' + (s ? describe(s.el) + ' ' + why + ' за 1,5 с' : 'кнопки нет');
        warn('«Отправить»: штатную кнопку не нажимаю - ' + (s ? describe(s.el) + ' ' + why + ' за 1,5 с после вставки' : 'кнопка не найдена - ' + sendStats()));
        render();
        return;
      }
      const edNow = liveEditor();
      if (!edNow || norm(edRead(edNow)) !== norm(DRAFT_TEXT)) {
        S.phase = 'inserted';
        S.notice = {cls: 'warn', title: 'Текст в поле изменился - отправку не нажимаю', text: 'Проверьте поле и отправьте сами.'};
        D.sendRes = hhmmss() + ' · не нажата: текст в поле изменился до нажатия';
        warn('«Отправить»: штатную кнопку не нажимаю - ' + (edNow ? 'текст в поле изменился после вставки' : 'поле ответа пропало после вставки'));
        render();
        return;
      }
      const btnDesc = describe(btn.el) + ' «' + labelOf(btn.el) + '»';
      S.clickedAt = Date.now();
      try {
        btn.el.click();
      } catch (e) {
        S.phase = 'inserted';
        S.notice = {cls: 'bad', title: 'Нажатие кнопки не удалось', text: e.message};
        D.sendRes = hhmmss() + ' · ошибка click(): ' + e.message;
        warn('«Отправить»: click() по ' + btnDesc + ' выбросил ошибку: ' + e.message);
        render();
        return;
      }
      D.sendRes = hhmmss() + ' · нажата ' + btnDesc + ' (click())';
      log('нажата штатная кнопка: ' + btnDesc);
      renderDiag();
      let cleared = false;
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        if (tok !== S.tok) return;
        if (editorEmptyNow()) { cleared = true; break; }
      }
      if (cleared) {
        D.sendRes += ' · поле очистилось ✓';
        finishSent(DRAFT_TEXT, 'кнопку «Отправить» в подсказке');
      } else {
        D.sendRes += ' · поле не очистилось за 4 с ✗';
        S.phase = 'inserted';
        S.notice = {cls: 'warn', title: 'Кнопка нажата, но поле ответа не очистилось',
          text: 'Проверьте ленту: ушло ли сообщение. Подробности - в «Диагностике».'};
        warn('«Отправить»: нажата ' + btnDesc + ', но поле ответа не очистилось за 4 с - сообщение могло не уйти, проверьте ленту');
        render();
      }
    }

    function finishSent(text, how) {
      S.phase = 'sent';
      S.notice = null;
      S.sent = {time: hhmm(), edit: editLabel(text, DRAFT_TEXT), how};
      log('отправлено через ' + how + ', ' + S.sent.edit);
      render();
      const tok = S.tok;
      setTimeout(() => {
        if (tok === S.tok && S.phase === 'sent') setCollapsed(true);
      }, RM ? 0 : 900);
    }

    async function actUndo() {
      if (S.busy) return;
      const ed = liveEditor();
      if (!ed || !S.prev) {
        warn('«Вернуть как было»: ' + (!ed ? 'поле ответа не найдено - ' + editorStats() : 'нет сохранённого прежнего текста'));
        S.phase = 'idle';
        render();
        return;
      }
      const p = S.prev;
      S.busy = true;
      let r;
      try { r = p.kind === 'ce' && ed.kind === 'ce' ? await edWrite(ed, p.text, p.html) : await edWrite(ed, p.text); } finally { S.busy = false; }
      D.undo = hhmmss() + ' · ' + (r.focus ? r.focus + ' · ' : '') + (r.steps.join(' → ') || 'без шагов') + ' · '
        + (r.ok ? 'поле вернулось ✓' : 'поле не совпало с прежним ✗') + (r.srcNote ? ' · ' + r.srcNote : '');
      if (r.ok) {
        log('возврат поля: ок');
        S.phase = 'idle';
        S.prev = null;
        S.notice = null;
      } else {
        // Прежний текст не теряем: «Вернуть как было» можно нажать ещё раз.
        warn('«Вернуть как было»: поле не совпало с прежним (было ' + norm(p.text).length + ' знаков, стало ' + norm(edRead(ed)).length + ')');
        S.phase = 'inserted';
        S.notice = {cls: 'warn', title: 'Поле вернулось не полностью', text: r.hint || 'Проверьте поле ответа.'};
      }
      render();
    }

    // Отправка менеджером штатной кнопкой после «Изменить»: считаем правку для строки «Отправлено».
    function watchNativeSend(how) {
      const ed = R.editor;
      if (!ed) return;
      const text = edRead(ed);
      const tok = S.tok;
      setTimeout(() => {
        if (tok !== S.tok || S.phase !== 'inserted') return;
        if (editorEmptyNow() && norm(text)) finishSent(text, how);
        else log('после нажатия (' + how + ') поле не очистилось за 1,5 с - отправку не засчитываю');
      }, 1500);
    }
    function onDocClick(e) {
      if (!e.isTrusted || S.phase !== 'inserted' || !R.send) return;
      const b = R.send.el;
      if (e.target === b || (e.target instanceof Node && b.contains(e.target))) watchNativeSend('штатную кнопку Omnidesk');
    }
    function onDocKey(e) {
      if (!e.isTrusted || S.phase !== 'inserted' || !R.editor) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target instanceof Node && R.editor.el.contains(e.target)) {
        watchNativeSend('Ctrl+Enter');
      }
    }

    function lev(a, b) {
      const n = b.length;
      let prev = [];
      for (let j = 0; j <= n; j++) prev.push(j);
      for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= n; j++) {
          row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = row;
      }
      return prev[n];
    }
    function editLabel(text, base) {
      const d = lev(norm(text), norm(base));
      if (d === 0) return 'без правок';
      return 'правка ' + Math.max(1, Math.round(d / Math.max(base.length, 1) * 100)) + '%';
    }

    /* ---------- стили ---------- */
    const CSS_BASE = `
:host{all:initial;display:block;box-sizing:border-box;font-family:inherit;font-size:13px;line-height:1.4;color:#e8e8e8;
  -webkit-font-smoothing:antialiased;text-align:left;
  --accent:#8a92ff;--accent-btn:#5a63de;--accent-btn-h:#6971ec;--accent-soft:rgba(138,146,255,.16);
  --accent-line:rgba(138,146,255,.55);--accent-ring:rgba(138,146,255,.28);
  --ok:#5bd68e;--ok-bg:rgba(91,214,142,.13);--ok-line:rgba(91,214,142,.36);
  --warn:#f2c65c;--warn-bg:rgba(242,198,92,.11);--warn-line:rgba(242,198,92,.36);
  --bad:#ff7d70;--bad-bg:rgba(255,125,112,.12);--bad-line:rgba(255,125,112,.4);
  --wait:#b4b4b4;--wait-bg:rgba(255,255,255,.07);--link:#3d9bff}
*,*::before,*::after{box-sizing:border-box}
button{font:inherit;color:inherit;cursor:pointer;margin:0}
button:disabled{cursor:default}
[hidden]{display:none!important}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ico{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}
.spark{color:var(--accent)}
.lnk{color:var(--link);background:none;border:0;padding:0;font:inherit;cursor:pointer;text-decoration:none}
.lnk:hover{text-decoration:underline}
.btn{height:30px;border-radius:4px;border:1px solid #474747;background:#2e2e2e;padding:0 11px;font-size:12.5px;font-weight:600;
  display:inline-flex;align-items:center;justify-content:center;gap:5px;color:#ececec;white-space:nowrap;
  transition:background .15s,border-color .15s,opacity .15s}
.btn:hover:not(:disabled){background:#383838}
.btn .ico{width:13px;height:13px}
.btn.primary{background:var(--accent-btn);border-color:var(--accent-btn);color:#fff}
.btn.primary:hover:not(:disabled){background:var(--accent-btn-h)}
.btn:disabled{opacity:.45}
.btn.sm{height:26px;padding:0 9px;font-size:12px}
.btn.xs{height:26px;padding:0 10px;font-size:12px;border-radius:3px}
.spin{width:11px;height:11px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;display:inline-block;
  animation:rot .8s linear infinite;flex:none}
@keyframes rot{to{transform:rotate(360deg)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.fade-in{animation:fadeIn .3s ease}
.reveal{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .36s cubic-bezier(.2,.7,.2,1),opacity .26s ease}
.reveal.open{grid-template-rows:1fr;opacity:1}
.reveal-in{min-height:0;overflow:hidden}
.plq{display:flex;gap:8px;align-items:flex-start;border-radius:5px;padding:8px 9px;margin-bottom:10px;font-size:12px;border:1px solid}
.plq .ico{margin-top:1px;width:14px;height:14px}
.plq b{display:block;font-weight:650;line-height:1.35}
.plq span{display:block;opacity:.85;font-size:11.5px;margin-top:2px}
.plq.bad{background:var(--bad-bg);border-color:var(--bad-line);color:var(--bad)}
.plq.warn{background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn)}
.note-row{display:flex;align-items:center;gap:6px;background:var(--accent-soft);color:#c9cdff;border-radius:5px;padding:5px 5px 5px 8px;
  font-size:12px;margin-bottom:10px;flex-wrap:wrap;animation:fadeIn .25s}
.note-row>span{flex:1;min-width:120px}
.note-row.warn{background:var(--warn-bg);color:var(--warn)}
.note-row.ask{padding:7px 8px}
.note-row.ask>span{flex:1 1 calc(100% - 26px)}
.diag{font-size:11px;color:#bdbdbd;line-height:1.4}
.diag dl{margin:0;display:grid;grid-template-columns:76px minmax(0,1fr);gap:3px 6px}
.diag dt{color:#8e8e8e}
.diag dd{margin:0;overflow-wrap:anywhere;color:#d6d6d6}
.diag .ok{color:var(--ok)}.diag .no{color:var(--bad)}
.diag ol{margin:6px 0 0;padding:0 0 0 0;list-style:none;max-height:120px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;
  font-size:10.5px;color:#a6a6a6;border-top:1px solid #2e2e2e;padding-top:5px}
.diag ol li{padding:1px 0;overflow-wrap:anywhere}
.diag-btns{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}
.demo{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#141414;background:var(--warn);
  border-radius:3px;padding:1px 4px;flex:none;border:0;line-height:1.4}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{transition-duration:0s!important;animation-duration:0s!important;animation-iteration-count:1!important}}
`;
    const CSS_CARD = `
:host{margin:0 0 12px}
.hc{background:#232323;border:1px solid var(--accent-line);border-radius:6px;box-shadow:0 0 0 3px rgba(138,146,255,.06)}
.float .hc{box-shadow:0 12px 32px rgba(0,0,0,.55)}
.hc-top{display:flex;align-items:center;gap:6px;padding:8px 6px 6px 10px;cursor:pointer;user-select:none}
.hc-layers{display:grid;flex:1;min-width:0}
.hc-layer{grid-area:1/1;display:flex;align-items:center;gap:8px;min-width:0;transition:opacity .22s,visibility .22s,transform .28s}
.hc-tt{display:flex;flex-direction:column;min-width:0;flex:1}
.hc-tt b{font-size:13px;font-weight:700;color:#f2f2f2;white-space:nowrap}
.hc-tt small{font-size:10.5px;color:#8e8e8e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hc-layer.mini{opacity:0;visibility:hidden;transform:translateY(5px)}
.collapsed .hc-layer.full{opacity:0;visibility:hidden;transform:translateY(-5px)}
.collapsed .hc-layer.mini{opacity:1;visibility:visible;transform:none}
.mini-t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px;color:#cfcfcf;min-width:0;flex:1}
.mini-t .k{font-weight:700}
.t-ok{color:var(--ok)}.t-warn{color:var(--warn)}.t-bad{color:var(--bad)}.t-wait{color:var(--wait)}.t-acc{color:var(--accent)}
.hc-tg{width:26px;height:26px;border:0;background:none;border-radius:4px;color:#a8a8a8;display:grid;place-items:center;
  transition:transform .32s,background .15s;flex:none;padding:0}
.hc-top:hover .hc-tg{background:#2f2f2f}
.collapsed .hc-tg{transform:rotate(180deg)}
.hc-body{padding:0 10px 4px}
.hc-st{display:flex;align-items:center;gap:8px;margin:2px 0 9px;font-size:11px;color:#8e8e8e;min-width:0}
.hc-st>span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pill{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 7px;border-radius:10px;font-size:11px;font-weight:700;white-space:nowrap;flex:none}
.pill i{width:6px;height:6px;border-radius:50%;background:currentColor}
.pill.ok{background:var(--ok-bg);color:var(--ok)}
.pill.acc{background:var(--accent-soft);color:var(--accent)}
.pill.wait{background:var(--wait-bg);color:var(--wait)}
.pill.warn{background:var(--warn-bg);color:var(--warn)}
.pill.wait i{animation:pulse 1.2s infinite}
@keyframes pulse{50%{opacity:.35}}
.conf{margin-bottom:8px}
.tline{display:flex;align-items:center;justify-content:space-between;gap:2px;min-height:26px;margin:0 -4px}
.tname{font-size:12.5px;font-weight:700;color:#f2f2f2;padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;cursor:default}
.tconf{height:26px;border:0;background:none;border-radius:4px;padding:0 4px;display:inline-flex;align-items:center;gap:2px;
  white-space:nowrap;font-size:11.5px;color:#a6a6a6;transition:background .15s;flex:none}
.tconf:hover,.tconf[aria-expanded="true"]{background:#303030}
.tconf span{border-bottom:1px dotted #6b6b6b}
.tconf b{font-size:12.5px;color:var(--ok);font-variant-numeric:tabular-nums;margin-left:3px}
.cbd{padding:8px 9px;background:#1b1b1b;border:1px solid #2e2e2e;border-radius:5px;margin-top:5px}
.clist{list-style:none;margin:0;padding:0;font-size:12px}
.clist li{display:grid;grid-template-columns:14px 1fr;gap:6px;align-items:start;padding:2px 0;color:#d6d6d6}
.clist .ci{display:grid;place-items:center;height:17px}
.clist .ci .ico{width:12px;height:12px;stroke-width:2.2}
.clist li.ok .ci{color:var(--ok)}
.clist li.warn .ci{color:var(--warn)}
.topic-only{font-size:12px;color:#a6a6a6;margin:0 0 9px}
.topic-only b{color:#ececec}
.plq .btn{margin-top:7px}
.stages{display:flex;flex-wrap:wrap;align-items:center;gap:5px;font-size:12px;color:#cfcfcf;margin-bottom:9px}
.st{display:inline-flex;align-items:center;gap:5px}
.st.run{color:var(--wait)}
.skel{display:grid;gap:8px;padding:11px 10px;border:1px dashed #3a3a3a;border-radius:5px;margin-bottom:10px}
.skel i{height:9px;border-radius:5px;background:linear-gradient(90deg,#2c2c2c 0%,#3a3a3a 50%,#2c2c2c 100%);background-size:200% 100%;animation:shimmer 1.5s linear infinite}
.skel i:nth-child(1){width:92%}.skel i:nth-child(3){width:74%}.skel i:nth-child(4){width:46%}
@keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.hint-sm{font-size:11px;color:#8e8e8e;margin:-4px 0 10px}
.draft{background:#1a1a1a;border:1px solid #333;border-radius:5px;padding:9px 10px 8px;margin-bottom:9px}
.draft-text{font-size:14px;line-height:1.5;color:#f2f2f2;overflow-wrap:anywhere}
.sub{background:rgba(138,146,255,.2);border-bottom:1px dotted #a3a9ff;border-radius:2px;padding:0 2px;cursor:help;color:#fff}
.sub:hover,.sub:focus{background:rgba(138,146,255,.34);outline:none}
.sub.warn{background:rgba(242,198,92,.16);border-bottom-color:#e0b040}
.draft-foot{margin-top:7px;font-size:11px;color:#8e8e8e}
.c-ok{color:var(--ok)}
.draft.sent{opacity:.7}
.actions{display:flex;gap:6px;margin-bottom:10px}
.actions .btn{flex:1;min-width:0}
.sent-line{display:flex;align-items:center;gap:5px;color:var(--ok);font-size:12.5px;margin-bottom:7px}
.sent-line .ico{stroke-width:2.2;width:14px;height:14px}
.sent-line span{color:#a6a6a6}
.fold{border-top:1px solid #333}
.fold-h{width:100%;display:flex;align-items:center;gap:4px;border:0;background:none;padding:8px 0;font-size:12px;font-weight:650;color:#dcdcdc;text-align:left}
.fold-h>span:first-child{flex:none}
.fold-s{flex:1;min-width:0;text-align:right;font-weight:500;font-size:10.5px;color:#8e8e8e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fold-h>.ico{width:13px;height:13px;color:#9a9a9a;transition:transform .32s;margin-left:auto}
.fold.open .fold-h>.ico{transform:rotate(180deg)}
.fold-c{padding:0 0 9px}
.fact{display:grid;grid-template-columns:70px minmax(0,1fr) 22px;gap:6px;align-items:start;padding:3px 0;font-size:12px}
.fk{color:#9a9a9a}
.fv{color:#ececec;font-weight:600}
.fv small{display:block;font-size:10.5px;color:#868686;font-weight:400}
.fopen{color:#3d9bff;text-decoration:none;font-weight:700;margin-left:3px;font-size:12px}
.fopen:hover{text-decoration:underline}
.fv small.w{color:var(--warn)}
.flag{width:22px;height:20px;border:0;background:none;color:#6e6e6e;border-radius:4px;display:grid;place-items:center;opacity:.7;padding:0;
  transition:opacity .15s,background .15s,color .15s}
.flag .ico{width:13px;height:13px}
.fact:hover .flag,.flag:focus-visible{opacity:1}
.flag:hover{background:#303030;color:#bdbdbd}
.fact.flagged .flag{color:var(--bad);opacity:1}
.fact.flagged .flag .fl{fill:currentColor}
.fact.flagged .fv small{color:var(--bad)}
.why-lead{margin:0 0 5px;font-size:12px;color:#ececec}
.why{margin:0;padding:0;list-style:none;font-size:11.5px;color:#bdbdbd}
.why li{padding:2px 0}
.why b{color:#e6e6e6;font-weight:600}
.fb-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fb-hint{font-size:11px;color:#8e8e8e;display:inline-flex;align-items:center;gap:3px}
.fb-hint .ico{width:11px;height:11px}
.fb-reasons{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}
.fb-done{display:flex;align-items:flex-start;gap:6px;font-size:11.5px;color:#d6d6d6;background:#1b1b1b;border-radius:5px;padding:6px 8px}
.fb-done>.ico{color:var(--ok);margin-top:1px;width:13px;height:13px;stroke-width:2.2}
.fb-done span{flex:1}
`;
    const CSS_STRIP = `
:host{margin:0 0 6px}
.strip{border:1px solid;border-radius:3px;font-size:12.5px;animation:fadeIn .25s ease}
.sl{display:flex;align-items:center;gap:8px;min-height:34px;padding:3px 6px 3px 10px;min-width:0}
.sl>.ico{width:14px;height:14px}
.sl b{font-weight:650;white-space:nowrap}
.sl .dim{color:#a9a9a9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.sl .sp{flex:1}
.strip.ready,.strip.guard{background:var(--accent-soft);border-color:var(--accent-line);color:#c9cdff}
.strip.ok{background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok)}
.strip.warn{background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn)}
.strip.bad{background:var(--bad-bg);border-color:var(--bad-line);color:var(--bad)}
.strip.wait{background:#222;border-color:#333;color:#c8c8c8}
.strip.on-light.ready,.strip.on-light.guard{background:#eef0ff;border-color:#b9bdf5;color:#33378f}
.strip.on-light .dim{color:#55597a}
.strip.on-light.ok{background:#e8f7ee;border-color:#9fd8b5;color:#1b7340}
.strip.on-light.warn{background:#fff5d9;border-color:#e8cd82;color:#7d5900}
.strip.on-light.bad{background:#fdeceb;border-color:#f0b0a9;color:#a1261a}
.strip.on-light.wait{background:#f1f1f1;border-color:#dadada;color:#555}
.strip.on-light .btn{background:#fff;border-color:#c8c8c8;color:#222}
.strip.on-light .btn:hover:not(:disabled){background:#f0f0f0}
.strip.on-light .btn.primary{background:var(--accent-btn);border-color:var(--accent-btn);color:#fff}
`;
    function applyCss(root, css) {
      try {
        if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in root) {
          const sh = new CSSStyleSheet();
          sh.replaceSync(css);
          root.adoptedStyleSheets = [sh];
          return 'adoptedStyleSheets';
        }
      } catch (e) { /* запасной путь ниже */ }
      const st = document.createElement('style');
      st.textContent = css;
      root.appendChild(st);
      return '<style> в Shadow DOM';
    }

    /* ---------- карточка ---------- */
    let cardHost = null, cardRoot = null, cardWrap = null, cardEls = null;
    let stripHost = null, stripRoot = null, stripWrap = null;
    const M = {cardParent: null, cardFloat: false, stripParent: null, stripLight: false};
    // Фон под полосой: на светлой теме Omnidesk полосу перекрашиваем, иначе текст не читается.
    function onLightBg(el) {
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(getComputedStyle(n).backgroundColor || '');
        if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) continue;
        return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 > 0.6;
      }
      return false;
    }

    function makeHost(tag) {
      const host = document.createElement(tag);
      host.setAttribute('data-csai-demo', VERSION);
      host.style.display = 'block';
      const root = host.attachShadow({mode: 'open'});
      root.addEventListener('click', onUiClick);
      // Кнопки подсказки не забирают фокус: если курсор стоит в поле ответа, редактор остаётся активным.
      root.addEventListener('mousedown', e => {
        if (e.target && e.target.closest && e.target.closest('button')) e.preventDefault();
      });
      return {host, root};
    }
    function createCard() {
      const m = makeHost('csai-demo-card');
      cardHost = m.host;
      cardRoot = m.root;
      D.css = applyCss(cardRoot, CSS_BASE + CSS_CARD);
      const full = h('div', {class: 'hc-layer full'});
      const mini = h('div', {class: 'hc-layer mini'});
      const tg = h('button', {class: 'hc-tg', type: 'button', 'aria-label': 'Свернуть подсказку', 'aria-expanded': 'true'}, icon('chevUp'));
      const body = h('div', {class: 'hc-body'});
      const reveal = h('div', {class: 'reveal open'}, h('div', {class: 'reveal-in'}, body));
      const card = h('section', {class: 'hc', 'aria-label': 'Подсказка ответа'},
        h('div', {class: 'hc-top', 'data-act': 'toggle'}, h('div', {class: 'hc-layers'}, full, mini), tg), reveal);
      cardWrap = h('div', {class: 'wrap'}, card);
      cardRoot.appendChild(cardWrap);
      cardEls = {full, mini, tg, body, reveal, card};
    }
    function createStrip() {
      const m = makeHost('csai-demo-strip');
      stripHost = m.host;
      stripRoot = m.root;
      const how = applyCss(stripRoot, CSS_BASE + CSS_STRIP);
      if (D.css === '-') D.css = how;
      stripWrap = h('div', {class: 'strip ready'});
      stripRoot.appendChild(stripWrap);
    }
    function removeHost(host) {
      if (host && host.parentNode) host.parentNode.removeChild(host);
    }

    function pillData() {
      if (S.mode === 'noid') return ['warn', 'Нет ID Умскул'];
      if (S.mode === 'rebuilding') return ['wait', 'Готовится'];
      if (S.phase === 'sent') return ['ok', 'Отправлено'];
      if (S.phase === 'sending') return ['wait', 'Отправляю…'];
      if (S.phase === 'inserting') return ['wait', 'Вставляю…'];
      if (S.phase === 'inserted') return ['acc', 'Вставлено'];
      return ['ok', 'Готов'];
    }
    function miniLine() {
      if (S.mode === 'noid') return [h('span', {class: 'k t-warn'}, 'Нет ID Умскул'), ' · нужна почта'];
      if (S.mode === 'rebuilding') return [h('span', {class: 'k t-wait'}, 'Готовится'), ' · ID Умскул найден'];
      if (S.phase === 'sent') return [h('span', {class: 'k t-ok'}, 'Отправлено ' + S.sent.time), ' · ' + S.sent.edit];
      if (S.phase === 'sending') return [h('span', {class: 'k t-wait'}, 'Отправляю…')];
      if (S.phase === 'inserting') return [h('span', {class: 'k t-wait'}, 'Вставляю…')];
      if (S.phase === 'inserted') return [h('span', {class: 'k t-acc'}, 'Вставлено'), ' · правьте в поле ответа'];
      return [h('span', {class: 'k t-ok'}, 'Готов'), ' · ' + TOPIC.name + ' · ' + CONF_PCT + '%'];
    }
    function fold(key, title, inner, summary) {
      const o = !!S.open[key];
      return h('div', {class: 'fold' + (o ? ' open' : ''), 'data-fold': key},
        h('button', {class: 'fold-h', type: 'button', 'data-act': 'fold', 'data-k': key, 'aria-expanded': String(o)},
          h('span', null, title), summary ? h('span', {class: 'fold-s'}, summary) : null, icon('chevDown')),
        h('div', {class: 'reveal' + (o ? ' open' : '')}, h('div', {class: 'reveal-in'}, h('div', {class: 'fold-c'}, inner))));
    }
    function plaque(cls, ic, title, text, extra) {
      return h('div', {class: 'plq ' + cls, role: 'status'}, icon(ic),
        h('div', null, h('b', null, title), text ? h('span', null, text) : null, extra || null));
    }
    function statusRow() {
      const p = pillData();
      return h('div', {class: 'hc-st'}, h('span', {class: 'pill ' + p[0]}, h('i'), p[1]),
        h('span', null, 'на сообщение ' + MSG_TIME));
    }
    function topicLine() {
      const o = !!S.open.conf;
      const list = h('ul', {class: 'clist'}, CONF.map(c => h('li', {class: c[0]},
        h('span', {class: 'ci'}, icon(c[0] === 'ok' ? 'check' : 'warn')), h('span', null, c[1]))));
      return h('div', {class: 'conf' + (o ? ' open' : ''), 'data-fold': 'conf'},
        h('div', {class: 'tline'},
          h('span', {class: 'tname', title: TOPIC.name + ' · ' + TOPIC.sub}, TOPIC.name),
          h('button', {class: 'tconf', type: 'button', 'data-act': 'fold', 'data-k': 'conf', 'aria-expanded': String(o),
            title: 'Из чего сложилась уверенность'}, h('span', null, 'уверенность'), h('b', null, CONF_PCT + '%'))),
        h('div', {class: 'reveal' + (o ? ' open' : '')}, h('div', {class: 'reveal-in'}, h('div', {class: 'cbd'}, list))));
    }
    function draftBox() {
      const parts = DRAFT.map(p => {
        if (typeof p === 'string') return p;
        return h('span', {class: 'sub', tabindex: '0', title: p.what + ' · ' + p.src}, p.v);
      });
      return h('div', {class: 'draft'}, h('div', {class: 'draft-text'}, parts),
        h('div', {class: 'draft-foot'}, 'Шаблон КС «' + TOPIC.tpl + '» · ', h('span', {class: 'c-ok'}, '✓ ' + TOPIC.check)));
    }
    function confirmRow(compact) {
      const q = 'В поле ответа уже есть текст. Заменить?';
      const yes = h('button', {class: 'btn ' + (compact ? 'xs' : 'sm') + ' primary', type: 'button', 'data-act': 'confirm-yes'}, 'Заменить');
      const no = h('button', {class: 'btn ' + (compact ? 'xs' : 'sm'), type: 'button', 'data-act': 'confirm-no'}, 'Отмена');
      return {q, yes, no};
    }
    function stripLive() {
      return wantStrip() && !!stripHost && stripHost.isConnected;
    }
    function actionsRow() {
      if (S.phase === 'confirm') {
        const c = confirmRow(false);
        return h('div', {class: 'note-row warn ask'}, icon('warn'), h('span', null, c.q), c.yes, c.no);
      }
      if (S.phase === 'inserted') {
        // В варианте 2 «Вернуть как было» - в полосе; если полоса не встала, кнопка остаётся в карточке.
        const undo = stripLive() ? null
          : h('button', {class: 'btn sm', type: 'button', 'data-act': 'undo'}, icon('undo'), 'Вернуть как было');
        return h('div', {class: 'note-row'}, icon('pencil'), h('span', null, 'Вставлено - правьте в поле ответа'), undo);
      }
      const sending = S.phase === 'sending' || S.phase === 'inserting';
      const editBtn = h('button', {class: 'btn', type: 'button', 'data-act': 'edit', title: 'Вставить в поле ответа', disabled: sending},
        S.phase === 'inserting' ? h('i', {class: 'spin'}) : icon('pencil'), S.phase === 'inserting' ? 'Вставляю…' : 'Изменить');
      if (wantStrip()) return h('div', {class: 'actions'}, editBtn);
      const sendBtn = h('button', {class: 'btn primary', type: 'button', 'data-act': 'send', title: 'Отправить клиенту', disabled: sending},
        S.phase === 'sending' ? h('i', {class: 'spin'}) : icon('send'), S.phase === 'sending' ? 'Отправляю…' : 'Отправить');
      return h('div', {class: 'actions'}, sendBtn, editBtn);
    }
    function factsFold() {
      const ok = FACTS.filter(f => !f.w).length, w = FACTS.length - ok;
      const summary = ok + ' ' + plural(ok, 'факт', 'факта', 'фактов') + ' ✓' + (w ? ' · ' + w + ' ' + plural(w, 'уточняется', 'уточняются', 'уточняются') : '');
      const rows = FACTS.map(f => {
        const fl = !!S.flags[f.k];
        const open = f.url ? h('a', {class: 'fopen', href: f.url, target: '_blank', rel: 'noopener noreferrer',
          title: 'Открыть в платформе для сверки', 'aria-label': 'Открыть в платформе - ' + f.l}, '↗') : null;
        return h('div', {class: 'fact' + (fl ? ' flagged' : '')}, h('span', {class: 'fk'}, f.l),
          h('span', {class: 'fv'}, f.v, open ? ' ' : null, open, h('small', {class: f.w ? 'w' : null}, fl ? 'отмечено: неверный факт' : f.m)),
          h('button', {class: 'flag', type: 'button', 'data-act': 'flag', 'data-k': f.k, title: 'Отметить: неверный факт',
            'aria-label': 'Отметить: неверный факт - ' + f.l, 'aria-pressed': String(fl)}, icon('flag')));
      });
      return fold('facts', 'Из платформы', rows, summary);
    }
    function whyFold(why) {
      return fold('why', 'Почему так', [h('p', {class: 'why-lead'}, why.lead),
        h('ul', {class: 'why'}, why.items.map(it => h('li', null, h('b', null, it[0]), ' - ' + it[1])))]);
    }
    function fbFold() {
      let inner;
      if (S.bad) {
        inner = h('div', {class: 'fb-done'}, icon('check'),
          h('span', null, 'Отмечено: ' + S.bad + '. В демо отзыв никуда не отправляется.'),
          h('button', {class: 'lnk', type: 'button', 'data-act': 'unbad'}, 'Отменить'));
      } else {
        inner = [h('div', {class: 'fb-row'},
          h('button', {class: 'btn sm', type: 'button', 'data-act': 'bad-open', 'aria-expanded': String(S.badOpen)}, icon('thumb'), 'Плохо', icon('chevDown')),
          h('span', {class: 'fb-hint'}, 'или ', icon('flag'), ' у строки в «Из платформы»')),
        S.badOpen ? h('div', {class: 'fb-reasons'}, BAD.map(b => h('button', {class: 'btn xs', type: 'button', 'data-act': 'bad', 'data-k': b}, b))) : null];
      }
      return fold('fb', 'Отзыв', inner, S.bad ? 'отмечено' : '');
    }
    function diagSummary() {
      const miss = [];
      if (!R.column) miss.push('колонки');
      if (!R.editor) miss.push('поля');
      if (!R.send) miss.push('кнопки');
      if (S.mode === 'noid' && /^не найдено/.test(D.idField)) miss.push('ID Умскул');
      return miss.length ? 'нет ' + miss.join(', ') : 'всё найдено ✓';
    }
    function modeLabel() {
      if (S.mode === 'noid') return 'Нет ID Умскул (csai_demo_state=noid) - жду заполнения поля';
      if (S.mode === 'rebuilding') return 'пересборка после «ID Умскул» (' + S.rebuildHow + ')';
      return 'готов' + (D.noidFlag ? ' - ID Умскул найден (' + S.rebuildHow + ')' : '');
    }
    function diagRows() {
      const sl = readSendList();
      const allowed = sendAllowed();
      return [
        ['Версия', VERSION + ' · запущен ' + D.started],
        ['Обращение', D.caseId + (D.caseSrc ? ' (' + D.caseSrc + ')' : '')],
        ['Вариант', D.layout === '1' ? '1 - кнопки в карточке, без полосы' : '2 - карточка и полоса над полем ответа'],
        ['Состояние', modeLabel()],
        ['Отправка', (allowed.ok ? 'разрешена: ' : 'выключена: ') + allowed.why + ' · список ' + (sl.err ? sl.err : '[' + sl.list.join(', ') + ']')],
        ['Колонка', D.column],
        ['Поле ответа', D.editor],
        ['Кнопка', D.send],
        ['Полоса', wantStrip() ? D.strip : 'не нужна в варианте 1'],
        ['ID Умскул', D.idField],
        ['Редактор API', D.redactor],
        ['Стили', D.css],
        ['Вставка', D.insert],
        ['Возврат', D.undo],
        ['Нажатие', D.sendRes],
        ['Перевставки', D.remounts + (D.lastRemount ? ' · последняя ' + D.lastRemount : '') + (D.pausedUntil > Date.now() ? ' · пауза' : '')],
        ['CSP', D.csp.length ? D.csp.slice(-3).join('; ') : 'нарушений не было'],
      ];
    }
    function diagText() {
      return ['[csai-demo] диагностика ' + hhmmss()].concat(diagRows().map(r => r[0] + ': ' + r[1]))
        .concat(['Журнал:']).concat(D.events.slice(-15)).join('\n');
    }
    function diagInner() {
      const dl = h('dl', null);
      diagRows().forEach(r => {
        const v = String(r[1]);
        const cls = /^найден|разрешена|^перед|^#|^по заголовку|^готов/.test(v) ? 'ok' : (/^не найден|^выключена|✗/.test(v) ? 'no' : null);
        add(dl, [h('dt', null, r[0]), h('dd', {class: cls}, v)]);
      });
      return [dl,
        h('ol', null, D.events.slice(-8).reverse().map(e => h('li', null, e))),
        h('div', {class: 'diag-btns'},
          h('button', {class: 'btn xs', type: 'button', 'data-act': 'refind'}, 'Найти заново'),
          h('button', {class: 'btn xs', type: 'button', 'data-act': 'copy'}, 'Скопировать'))];
    }
    function diagFold() {
      return fold('diag', 'Диагностика', h('div', {class: 'diag', 'data-diag': '1'}, diagInner()), diagSummary());
    }
    let diagSig = '';
    function renderDiag(onlyIfChanged) {
      const sig = diagRows().map(r => r[1]).join('|') + '|' + D.events.length + D.events[D.events.length - 1];
      if (onlyIfChanged && sig === diagSig) return;
      diagSig = sig;
      if (!cardRoot) return;
      cardRoot.querySelectorAll('[data-diag]').forEach(box => setKids(box, diagInner()));
      cardRoot.querySelectorAll('[data-fold="diag"] .fold-s').forEach(s => { s.textContent = diagSummary(); });
    }

    function bodyNodes() {
      const out = [];
      if (M.cardFloat) {
        out.push(plaque('warn', 'warn', 'Правая колонка не найдена', 'Карточка показана поверх страницы. Подробности - в «Диагностике».'));
      }
      out.push(statusRow());
      if (S.mode === 'noid') {
        const refresh = h('button', {class: 'btn xs', type: 'button', 'data-act': 'refresh', title: 'Проверить поле «ID Умскул» сейчас'},
          icon('refresh'), 'Обновить');
        out.push(plaque('warn', 'idcard', 'Нет ID Умскул - заполните почту в карточке клиента, подсказка обновится сама', '', refresh));
        if (S.notice) out.push(plaque(S.notice.cls, S.notice.cls === 'bad' ? 'stop' : 'warn', S.notice.title, S.notice.text));
        out.push(h('p', {class: 'topic-only'}, 'Тема: ', h('b', null, TOPIC.name)), whyFold(WHY_NOID), fbFold(), diagFold());
        return out;
      }
      if (S.mode === 'rebuilding') {
        out.push(h('div', {class: 'stages'}, h('span', {class: 'st run'}, h('i', {class: 'spin'}), 'В карточке появился ID Умскул - собираю подсказку')),
          h('div', {class: 'skel', 'aria-hidden': 'true'}, h('i'), h('i'), h('i'), h('i')),
          h('div', {class: 'hint-sm'}, S.rebuildHow === 'кнопка «Обновить»' ? 'Обновляется по кнопке «Обновить»' : 'Обновилась сама после записи в карточку клиента'),
          diagFold());
        return out;
      }
      if (S.phase === 'sent') {
        out.push(h('div', {class: 'sent-line'}, icon('check'), h('b', null, 'Отправлено ' + S.sent.time), h('span', null, '· ' + S.sent.edit)));
        out.push(h('div', {class: 'draft sent'}, h('div', {class: 'draft-text'}, DRAFT_TEXT),
          h('div', {class: 'draft-foot'}, 'Ушло через ' + S.sent.how + ' · демо')));
        out.push(factsFold(), whyFold(WHY), fbFold(), diagFold());
        return out;
      }
      if (S.notice) out.push(plaque(S.notice.cls, S.notice.cls === 'bad' ? 'stop' : 'warn', S.notice.title, S.notice.text));
      out.push(topicLine(), draftBox(), actionsRow(), factsFold(), whyFold(WHY), fbFold(), diagFold());
      return out;
    }

    function morph(el, mutate) {
      if (RM || !el.isConnected || S.collapsed) { mutate(); return; }
      const h0 = el.offsetHeight;
      clearTimeout(el._csaiT);
      el.style.transition = 'none';
      el.style.height = '';
      el.style.overflow = '';
      mutate();
      const h1 = el.offsetHeight;
      el.classList.remove('fade-in');
      void el.offsetWidth;
      el.classList.add('fade-in');
      if (Math.abs(h1 - h0) < 2) { el.style.transition = ''; return; }
      el.style.height = h0 + 'px';
      el.style.overflow = 'hidden';
      void el.offsetHeight;
      el.style.transition = 'height .36s cubic-bezier(.2,.7,.2,1)';
      el.style.height = h1 + 'px';
      el._csaiT = setTimeout(() => { el.style.height = ''; el.style.overflow = ''; el.style.transition = ''; }, 400);
    }

    function renderCard() {
      if (!cardEls) return;
      const e = cardEls;
      e.card.classList.toggle('collapsed', S.collapsed);
      cardWrap.classList.toggle('float', M.cardFloat);
      setKids(e.full, [icon('spark'), h('div', {class: 'hc-tt'}, h('b', null, 'Подсказка ответа'), h('small', null, 'текст КС · данные платформы')),
        h('span', {class: 'demo', title: 'Демо на тестовых данных'}, 'демо')]);
      setKids(e.mini, [icon('spark'), h('span', {class: 'mini-t'}, miniLine())]);
      e.tg.setAttribute('aria-expanded', String(!S.collapsed));
      e.tg.setAttribute('aria-label', S.collapsed ? 'Развернуть подсказку' : 'Свернуть подсказку');
      e.reveal.classList.toggle('open', !S.collapsed);
      morph(e.body, () => setKids(e.body, bodyNodes()));
    }

    function renderStrip() {
      if (!stripWrap) return;
      let cls, kids;
      const undo = () => h('button', {class: 'btn xs', type: 'button', 'data-act': 'undo'}, icon('undo'), 'Вернуть как было');
      if (S.mode === 'noid') {
        cls = 'warn';
        kids = [icon('idcard'), h('b', null, 'Нет ID Умскул'), h('span', {class: 'dim'}, '· заполните почту в карточке клиента, подсказка обновится сама')];
      } else if (S.mode === 'rebuilding') {
        cls = 'wait';
        kids = [h('i', {class: 'spin'}), h('b', null, 'Подсказка готовится'), h('span', {class: 'dim'}, '· ID Умскул найден')];
      } else if (S.phase === 'sent') {
        cls = 'ok';
        kids = [icon('check'), h('b', null, 'Отправлено ' + S.sent.time), h('span', {class: 'dim'}, '· ' + S.sent.edit)];
      } else if (S.phase === 'confirm') {
        const c = confirmRow(true);
        cls = 'warn';
        kids = [icon('warn'), h('b', null, c.q), h('span', {class: 'sp'}), c.yes, c.no];
      } else if (S.phase === 'sending' || S.phase === 'inserting') {
        cls = 'wait';
        kids = [h('i', {class: 'spin'}), h('b', null, S.phase === 'inserting' ? 'Вставляю…' : 'Отправляю…')];
      } else if (S.phase === 'inserted' && S.notice) {
        cls = S.notice.cls === 'bad' ? 'bad' : 'warn';
        kids = [icon('warn'), h('b', null, S.notice.title), h('span', {class: 'dim'}, S.notice.text ? '· ' + S.notice.text : ''), h('span', {class: 'sp'}), undo()];
      } else if (S.phase === 'inserted') {
        cls = 'guard';
        kids = [icon('pencil'), h('span', null, 'Вставлен черновик к сообщению ', h('b', null, S.insertedFor || MSG_TIME)), h('span', {class: 'sp'}), undo()];
      } else if (S.notice) {
        cls = S.notice.cls === 'bad' ? 'bad' : 'warn';
        kids = [icon('stop'), h('b', null, S.notice.title), h('span', {class: 'dim'}, S.notice.text ? '· ' + S.notice.text : ''), h('span', {class: 'sp'}),
          h('button', {class: 'btn xs primary', type: 'button', 'data-act': 'send', title: 'Отправить клиенту'}, icon('send'), 'Отправить'),
          h('button', {class: 'btn xs', type: 'button', 'data-act': 'edit', title: 'Вставить в поле ответа'}, icon('pencil'), 'Изменить')];
      } else {
        cls = 'ready';
        kids = [icon('spark'), h('b', null, 'Подсказка готова'), h('span', {class: 'dim'}, '· ' + TOPIC.name + ' · ' + CONF_PCT + '%'),
          h('span', {class: 'sp'}),
          h('button', {class: 'btn xs primary', type: 'button', 'data-act': 'send', title: 'Отправить клиенту'}, icon('send'), 'Отправить'),
          h('button', {class: 'btn xs', type: 'button', 'data-act': 'edit', title: 'Вставить в поле ответа'}, icon('pencil'), 'Изменить')];
      }
      stripWrap.className = 'strip ' + cls + (M.stripLight ? ' on-light' : '');
      setKids(stripWrap, h('div', {class: 'sl'}, kids));
    }

    function render() {
      safe(renderCard, 'renderCard');
      safe(renderStrip, 'renderStrip');
    }

    function setCollapsed(c) {
      S.collapsed = c;
      if (!cardEls) return;
      cardEls.card.classList.toggle('collapsed', c);
      cardEls.reveal.classList.toggle('open', !c);
      cardEls.tg.setAttribute('aria-expanded', String(!c));
      cardEls.tg.setAttribute('aria-label', c ? 'Развернуть подсказку' : 'Свернуть подсказку');
      if (!c) render();
    }
    function toggleFold(k) {
      S.open[k] = !S.open[k];
      [cardRoot, stripRoot].forEach(root => {
        if (!root) return;
        root.querySelectorAll('[data-fold="' + k + '"]').forEach(w => {
          w.classList.toggle('open', S.open[k]);
          const rv = w.querySelector('.reveal');
          if (rv) rv.classList.toggle('open', S.open[k]);
          w.querySelectorAll('[data-act="fold"]').forEach(b => b.setAttribute('aria-expanded', String(S.open[k])));
        });
      });
      if (k === 'diag' && S.open.diag) renderDiag();
    }
    function copyDiag() {
      const text = diagText();
      const done = ok => { if (ok) log('диагностика скопирована'); else warn('скопировать в буфер не удалось - текст диагностики выведен в консоль'); if (!ok) { try { console.info(text); } catch (e) { /* без консоли */ } } renderDiag(); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
          return;
        }
      } catch (e) { /* запасной путь */ }
      done(fallbackCopy(text));
    }
    function fallbackCopy(text) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        (cardRoot || stripRoot).appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e) { return false; }
    }

    function onSendError(e) {
      S.busy = false;
      warn('ошибка скрипта при вставке или отправке: ' + (e && e.message ? e.message : e));
      if (S.phase === 'sending' || S.phase === 'inserting') {
        S.phase = 'inserted';
        S.notice = {cls: 'bad', title: 'Ошибка скрипта при отправке', text: 'Проверьте поле ответа и отправьте сами. Подробности - в консоли.'};
        render();
      }
    }
    function onUiClick(e) {
      const t = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!t || t.disabled) return;
      const act = t.getAttribute('data-act');
      const k = t.getAttribute('data-k');
      safe(() => {
        switch (act) {
          case 'toggle': setCollapsed(!S.collapsed); break;
          case 'fold': toggleFold(k); break;
          case 'refresh': actRefresh(); break;
          case 'send': actSend(false).catch(onSendError); break;
          case 'edit': actEdit(false).catch(onSendError); break;
          case 'confirm-yes': if (S.confirmFor === 'send') actSend(true).catch(onSendError); else actEdit(true).catch(onSendError); break;
          case 'confirm-no': S.phase = 'idle'; S.confirmFor = null; render(); break;
          case 'undo': actUndo().catch(onSendError); break;
          case 'flag': S.flags[k] = !S.flags[k]; log('флажок «неверный факт»: ' + k + (S.flags[k] ? ' вкл' : ' выкл')); render(); break;
          case 'bad-open': S.badOpen = !S.badOpen; render(); break;
          case 'bad': S.bad = k; S.badOpen = false; log('отзыв «Плохо»: ' + k); render(); break;
          case 'unbad': S.bad = null; render(); break;
          case 'refind': R.findAt = 0; refindReply(true); ensureAll(true, true); log('поиск заново по кнопке'); render(); break;
          case 'copy': copyDiag(); break;
          default: break;
        }
      }, 'click ' + act);
    }

    /* ---------- «Нет ID Умскул»: слежение за полем в «Данных пользователя» ---------- */
    const ID_LABEL_RE = /^id\s*умскул\s*:?$/i;
    const ID_EMPTY_RE = /^(-|\u2014|\u2013|нет|не указано|не задано|не заполнено)?$/i;
    let lastIdCheck = 0;

    function findIdField() {
      const col = R.column && R.column.parent && R.column.parent.isConnected ? R.column.parent : null;
      const scope = col || document.body;
      if (!scope) return null;
      const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let n, i = 0;
      while ((n = w.nextNode()) && i++ < 20000) {
        const t = n.nodeValue;
        if (!t || t.length > 40 || !ID_LABEL_RE.test(t.trim())) continue;
        let label = n.parentElement;
        if (!label) continue;
        // Подпись бывает обёрнута в span внутри блока подписи: поднимаемся до блока, у которого есть сосед-значение.
        while (!label.nextElementSibling && label.parentElement && label.parentElement !== scope
          && norm(label.parentElement.textContent) === norm(label.textContent)) label = label.parentElement;
        return {label, value: label.nextElementSibling, row: label.parentElement || label, scope: col ? 'правая колонка' : 'вся страница'};
      }
      return null;
    }
    function readIdValue(f) {
      let v = '';
      const box = f.value || f.row;
      const inp = box.matches && box.matches('input, textarea') ? box : box.querySelector('input, textarea');
      if (inp) v = inp.value;
      else if (f.value) v = f.value.textContent;
      else {
        v = norm(f.row.textContent);
        const lt = norm(f.label.textContent);
        if (v.indexOf(lt) === 0) v = v.slice(lt.length);
      }
      v = norm(v);
      return ID_EMPTY_RE.test(v) ? '' : v;
    }
    // Значение держим только в памяти для сравнения; в журнал и диагностику оно не попадает.
    function checkId(reason) {
      lastIdCheck = Date.now();
      if (S.mode !== 'noid' || !S.caseId) return;
      const f = findIdField();
      if (!f) {
        D.idField = 'не найдено: нет подписи «ID Умскул» (' + (R.column ? 'искали в правой колонке' : 'искали по всей странице') + ')';
        problem('idfield', 'поле «ID Умскул» не найдено в «Данных пользователя» - автообновление не сработает, осталась кнопка «Обновить»');
        renderDiag(true);
        return;
      }
      resolved('idfield', 'поле «ID Умскул» найдено: ' + describe(f.row));
      const v = readIdValue(f);
      D.idField = 'найдено: ' + describe(f.value || f.row) + ' (' + f.scope + '), ' + (v ? 'заполнено' : 'пусто') + ' · ' + hhmmss() + ', ' + reason;
      if (S.idBase === null) {
        S.idBase = v;
        log(v ? 'поле «ID Умскул» уже заполнено - подсказка обновится, когда значение изменится, или по кнопке «Обновить»'
          : 'поле «ID Умскул» пустое - жду, когда его заполнят');
        renderDiag(true);
        return;
      }
      if (v && v !== S.idBase) {
        log('в поле «ID Умскул» появилось значение (' + reason + ') - пересобираю подсказку');
        rebuild(reason);
        return;
      }
      if (!v && S.idBase) {
        S.idBase = '';
        log('поле «ID Умскул» очистили - жду нового значения');
      }
      renderDiag(true);
    }
    function rebuild(how) {
      if (S.mode !== 'noid') return;
      const tok = S.tok;
      S.mode = 'rebuilding';
      S.rebuildHow = how;
      S.notice = null;
      render();
      setTimeout(() => {
        if (tok !== S.tok || S.mode !== 'rebuilding') return;
        S.mode = 'ready';
        log('подсказка пересобрана: тема «' + TOPIC.name + '», ' + CONF_PCT + '%');
        render();
      }, RM ? 0 : REBUILD_MS);
    }
    function actRefresh() {
      if (S.mode !== 'noid') return;
      const f = findIdField();
      if (!f) {
        warn('«Обновить»: поле «ID Умскул» не найдено - пересобираю подсказку без проверки поля');
        rebuild('кнопка «Обновить»');
        return;
      }
      if (readIdValue(f)) {
        log('«Обновить»: в поле «ID Умскул» есть значение - пересобираю подсказку');
        rebuild('кнопка «Обновить»');
        return;
      }
      S.notice = {cls: 'warn', title: 'ID Умскул пока пуст', text: 'Заполните почту в карточке клиента - подсказка обновится сама.'};
      warn('«Обновить»: поле «ID Умскул» ' + describe(f.value || f.row) + ' пустое - подсказку не пересобираю');
      render();
    }
    function startMode() {
      S.mode = noidWanted() ? 'noid' : 'ready';
      D.idField = S.mode === 'noid' ? 'ещё не проверяли' : 'не проверяется - нет csai_demo_state=noid';
      if (S.mode !== 'noid') return;
      log('режим «Нет ID Умскул» (csai_demo_state=noid): жду заполнения поля «ID Умскул»');
      checkId('открытие обращения');
    }
    let inputTimer = 0;
    function onDocInput() {
      if (S.mode !== 'noid' || inputTimer) return;
      inputTimer = setTimeout(() => {
        inputTimer = 0;
        safe(() => checkId('ввод на странице'), 'checkId');
      }, 300);
    }

    /* ---------- вставка блоков и устойчивость ---------- */
    function noteRemount(what) {
      const now = Date.now();
      D.remounts++;
      D.lastRemount = hhmmss() + ' (' + what + ')';
      D.remountTimes = D.remountTimes.filter(t => now - t < 10000);
      D.remountTimes.push(now);
      log(what + ' - вставляю заново');
      if (D.remountTimes.length >= 8) {
        D.pausedUntil = now + 10000;
        warn('страница удаляет блоки слишком часто - пауза 10 с');
      }
    }
    function ensureCard(fromPoll, force) {
      if (!cardHost) createCard();
      const placed = cardHost.isConnected && cardHost.parentNode === M.cardParent;
      if (placed && !M.cardFloat && !force) return;
      if (placed && M.cardFloat && !fromPoll && !force) return;
      const col = findColumn();
      R.column = col;
      if (col) {
        if (M.cardParent && !placed) noteRemount('карточка пропала со страницы');
        const wasFloat = M.cardFloat;
        cardHost.style.position = '';
        cardHost.style.right = '';
        cardHost.style.bottom = '';
        cardHost.style.width = '';
        cardHost.style.maxHeight = '';
        cardHost.style.overflow = '';
        cardHost.style.zIndex = '';
        col.parent.insertBefore(cardHost, col.before && col.before.parentNode === col.parent ? col.before : col.parent.firstChild);
        M.cardParent = col.parent;
        M.cardFloat = false;
        D.column = 'найдена: ' + col.how + (col.visible ? '' : ' (сейчас скрыта)');
        resolved('column', 'правая колонка найдена: ' + col.how + ' - карточка перенесена в неё');
        if (col.visible) resolved('column-hidden', 'правая колонка снова видна');
        else problem('column-hidden', 'правая колонка ' + describe(col.el) + ' найдена, но скрыта (другая вкладка или нулевой размер) - карточки не видно');
        if (wasFloat || !placed) {
          log('карточка вставлена: ' + col.how);
          renderCard();
        }
        return;
      }
      if (placed && M.cardFloat) return;
      if (Date.now() - T0 < FLOAT_AFTER_MS) { D.column = 'ищу…'; return; }
      if (M.cardParent && !placed && !M.cardFloat) noteRemount('колонка с карточкой пропала');
      const s = cardHost.style;
      s.position = 'fixed';
      s.right = '16px';
      s.bottom = '16px';
      s.width = '300px';
      s.maxHeight = '75vh';
      s.overflow = 'auto';
      s.zIndex = '2147482000';
      (document.body || document.documentElement).appendChild(cardHost);
      M.cardParent = cardHost.parentNode;
      M.cardFloat = true;
      D.column = 'не найдена: нет ' + COLUMN_SELECTORS.join(', ') + ' и заголовка «Данные пользователя» - карточка поверх страницы';
      problem('column', 'правая колонка не найдена за ' + (FLOAT_AFTER_MS / 1000) + ' с: нет ' + COLUMN_SELECTORS.join(', ')
        + ' и видимого заголовка «Данные пользователя» - карточка показана поверх страницы');
      renderCard();
    }
    function ensureStrip(fromPoll, force) {
      if (!wantStrip()) {
        if (stripHost && stripHost.parentNode) removeHost(stripHost);
        M.stripParent = null;
        return;
      }
      if (!stripHost) createStrip();
      const placed = stripHost.isConnected && stripHost.parentNode === M.stripParent;
      if (placed && !force && R.composer && R.composer.isConnected && R.editor && R.editor.el.isConnected) return;
      if (!fromPoll && !force && Date.now() - R.findAt < 800) return;
      refindReply(true);
      if (!R.composer || !R.composer.parentNode) {
        D.strip = 'не вставлена: поле ответа не найдено';
        problem('strip', 'полоса не вставлена: поле ответа не найдено - ' + editorStats());
        return;
      }
      if (placed && stripHost.nextSibling === R.composer) return;
      if (M.stripParent && !placed) noteRemount('полоса пропала со страницы');
      R.composer.parentNode.insertBefore(stripHost, R.composer);
      M.stripParent = R.composer.parentNode;
      M.stripLight = onLightBg(M.stripParent);
      D.strip = 'перед ' + describe(R.composer);
      resolved('strip', 'полоса вставлена');
      const sw = stripHost.getBoundingClientRect().width;
      if (sw < 200) problem('strip-narrow', 'полоса вставлена перед ' + describe(R.composer) + ', но узкая (' + Math.round(sw) + ' px) - место выбрано неудачно');
      else resolved('strip-narrow', 'ширина полосы в норме');
      log('полоса вставлена перед ' + describe(R.composer));
      renderStrip();
      if (S.phase === 'inserted') renderCard();
    }
    function ensureAll(fromPoll, force) {
      if (stopped || !S.caseId) return;
      if (D.pausedUntil > Date.now() && !force) return;
      safe(() => ensureCard(fromPoll, force), 'ensureCard');
      safe(() => ensureStrip(fromPoll, force), 'ensureStrip');
      if (fromPoll && Date.now() - R.findAt > 3000 && (!R.editor || editorStale())) refindReply(true);
    }

    let moTimer = 0;
    let stopped = false;
    const mo = new MutationObserver(() => {
      if (moTimer) return;
      moTimer = setTimeout(() => {
        moTimer = 0;
        ensureAll(false, false);
        if (S.mode === 'noid') safe(() => checkId('изменение страницы'), 'checkId');
      }, 120);
    });

    function onCase(c) {
      const id = c ? c.id : null;
      if (id === S.caseId) return;
      const was = S.caseId;
      resetState();
      S.caseId = id;
      R.editor = null;
      R.send = null;
      R.composer = null;
      R.findAt = 0;
      D.caseId = id || '-';
      D.caseSrc = c ? c.src : '';
      D.insert = '-';
      D.undo = '-';
      D.sendRes = '-';
      if (!id) {
        removeHost(cardHost);
        removeHost(stripHost);
        M.cardParent = null;
        M.stripParent = null;
        if (was) log('обращения на странице нет - блоки убраны');
        return;
      }
      log(was ? 'смена обращения: ' + was + ' → ' + id + ', состояние очищено' : 'обращение ' + id + ' (' + D.caseSrc + ')');
      resolved('case', 'обращение на странице появилось');
      if (c.src !== 'CurrentCaseId') problem('caseid', 'нет переменной CurrentCaseId, номер обращения взят из адреса - «Отправить» будет только вставлять текст');
      else resolved('caseid', 'переменная CurrentCaseId появилась');
      ensureAll(true, true);
      startMode();
      render();
    }

    let pollTimer = 0;
    function tick() {
      if (stopped) return;
      if (lsGet(FLAG_KEY) !== '1') { teardown('флаг csai_demo выключен'); return; }
      const lay = readLayout();
      if (lay !== D.layout) {
        const first = !D.layout;
        D.layout = lay;
        if (!first) log('вариант: ' + lay);
        ensureAll(true, true);
        render();
      }
      if (noidWanted() !== D.noidFlag) {
        D.noidFlag = noidWanted();
        log('режим «Нет ID Умскул» ' + (D.noidFlag ? 'включён' : 'выключен') + ' - состояние обращения сброшено');
        if (S.caseId) { const c = readCase(); S.caseId = null; onCase(c); }
      }
      onCase(readCase());
      ensureAll(true, false);
      if (S.mode === 'noid' && Date.now() - lastIdCheck >= ID_POLL_MS) checkId('опрос раз в ' + ID_POLL_MS / 1000 + ' с');
      if (S.open.diag) renderDiag(true);
    }

    function onCsp(e) {
      D.csp.push(hhmmss() + ' ' + (e.violatedDirective || e.effectiveDirective || '?') + ' ' + String(e.blockedURI || '').slice(0, 60));
      if (D.csp.length > 10) D.csp.shift();
      warn('CSP заблокировала: ' + (e.violatedDirective || '?') + ' ' + String(e.blockedURI || '').slice(0, 60));
    }

    // Необработанные ошибки самого демо - в журнал; ошибки страницы не трогаем.
    function ownError(stackOrFile) { return /sufler-demo/.test(String(stackOrFile || '')); }
    function onGlobalError(e) {
      if (!ownError(e.filename) && !ownError(e.error && e.error.stack)) return;
      warn('необработанная ошибка скрипта: ' + e.message + ' (строка ' + e.lineno + ')');
    }
    function onRejection(e) {
      const r = e.reason;
      if (!ownError(r && r.stack)) return;
      warn('необработанная ошибка в асинхронном коде: ' + (r && r.message ? r.message : r));
    }

    function teardown(why) {
      stopped = true;
      clearInterval(pollTimer);
      clearTimeout(moTimer);
      mo.disconnect();
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onDocKey, true);
      document.removeEventListener('input', onDocInput, true);
      document.removeEventListener('securitypolicyviolation', onCsp);
      window.removeEventListener('error', onGlobalError);
      window.removeEventListener('unhandledrejection', onRejection);
      removeHost(cardHost);
      removeHost(stripHost);
      api.active = false;
      log('остановлен: ' + why);
    }

    const api = {
      active: true,
      version: VERSION,
      state: S,
      diag: D,
      report: () => { const t = diagText(); try { console.info(t); } catch (e) { /* без консоли */ } return t; },
      refind: () => { refindReply(true); ensureAll(true, true); render(); return diagText(); },
      stop: () => teardown('вызван stop()'),
    };
    window.__csaiDemo = api;

    function init() {
      D.layout = readLayout();
      D.noidFlag = noidWanted();
      log('запущен, версия ' + VERSION + ', вариант ' + D.layout);
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onDocKey, true);
      document.addEventListener('securitypolicyviolation', onCsp);
      window.addEventListener('error', onGlobalError);
      window.addEventListener('unhandledrejection', onRejection);
      if (!window.jQuery) log('jQuery на странице нет');
      mo.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
      document.addEventListener('input', onDocInput, true);
      onCase(readCase());
      if (!S.caseId) problem('case', 'на странице нет CurrentCaseId и номера обращения в адресе (/cases/record/…) - блоки не показываю, проверяю раз в секунду');
      pollTimer = setInterval(() => safe(tick, 'tick'), POLL_MS);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => safe(init, 'init'));
    else safe(init, 'init');
  }
})();
