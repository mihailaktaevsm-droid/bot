'use strict';

/* =========================================================
   Ежедневник студента МГТУ им. Баумана
   Всё хранится локально на телефоне (localStorage).
   ========================================================= */

const STORE_KEY = 'bmstu-planner-v1';
const DEFAULT_GROUP = 'Э5-11/6';
const LKS_API = 'https://lks.bmstu.ru/lks-back/api/v1';

// Сетка пар МГТУ
const SLOTS = [
  { start: '08:30', end: '10:00' },
  { start: '10:10', end: '11:40' },
  { start: '11:50', end: '13:20' },
  { start: '14:05', end: '15:35' },
  { start: '15:55', end: '17:25' },
  { start: '17:35', end: '19:05' },
  { start: '19:15', end: '20:45' },
];

const DOW_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DOW_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const LESSON_TYPES = {
  lecture: { label: 'Лекция', tag: 'ЛК' },
  seminar: { label: 'Семинар', tag: 'СЕМ' },
  lab: { label: 'Лабораторная', tag: 'ЛАБ' },
  other: { label: 'Занятие', tag: '' },
};

const PALETTE = ['#2f6bff', '#ff6b3d', '#20b26b', '#a35cff', '#ff3b7f', '#00a5c8', '#e0a100', '#6b7cff', '#ff8a00', '#14a39a', '#d9468f', '#5e8c31'];

/* ---------------- даты ---------------- */

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => iso(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const dowIdx = (s) => (parse(s).getDay() + 6) % 7; // 0 = понедельник
const mondayOf = (s) => addDays(s, -dowIdx(s));
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

function guessSemesterStart() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  if (m >= 7) return `${y}-09-01`;
  if (m === 0) return `${y - 1}-09-01`;
  return `${y}-02-09`;
}

function fmtDay(s) {
  const d = parse(s);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

function fmtRel(s) {
  const diff = diffDays(todayISO(), s);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  const d = parse(s);
  const base = `${DOW_SHORT[dowIdx(s)].toLowerCase()}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return base;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/* ---------------- состояние ---------------- */

function defaultState() {
  return {
    tasks: [],
    settings: { group: DEFAULT_GROUP, semesterStart: guessSemesterStart(), weeks: 18, lksUuid: '' },
    schedule: { lessons: [], updatedAt: null, fetchedAt: null, source: null, title: '' },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return {
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
      settings: { ...d.settings, ...(s.settings || {}) },
      schedule: { ...d.schedule, ...(s.schedule || {}) },
    };
  } catch (e) {
    return defaultState();
  }
}

let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Не удалось сохранить: память переполнена'); }
}

const ui = {
  tab: 'day',
  date: todayISO(),
  lastToday: todayISO(),
  hwMode: 'due',
  showDone: false,
  openSubjects: new Set(),
  weekParity: null,
  draft: null,
  lessonDraft: null,
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- расписание ---------------- */

function weekInfo(s) {
  const start = mondayOf(state.settings.semesterStart || guessSemesterStart());
  const n = Math.floor(diffDays(start, s) / 7) + 1;
  const weeks = Number(state.settings.weeks) || 18;
  return { n, numerator: n % 2 === 1, inSemester: n >= 1 && n <= weeks };
}

function weekMatches(week, numerator) {
  return week === 'all' || (week === 'ch' && numerator) || (week === 'zn' && !numerator);
}

function lessonsFor(s) {
  const w = weekInfo(s);
  if (!w.inSemester) return [];
  const day = dowIdx(s) + 1;
  return state.schedule.lessons
    .filter((l) => l.day === day && weekMatches(l.week, w.numerator))
    .sort((a, b) => toMin(a.start) - toMin(b.start));
}

function lessonsForWeekday(day, numerator) {
  return state.schedule.lessons
    .filter((l) => l.day === day && weekMatches(l.week, numerator))
    .sort((a, b) => toMin(a.start) - toMin(b.start));
}

function allSubjects() {
  const set = new Set();
  state.schedule.lessons.forEach((l) => l.subject && set.add(l.subject));
  state.tasks.forEach((t) => t.subject && set.add(t.subject));
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
}

function subjectColor(name) {
  if (!name) return 'var(--accent)';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function nextLessonDate(subject, from = todayISO()) {
  for (let i = 1; i <= 70; i++) {
    const d = addDays(from, i);
    if (lessonsFor(d).some((l) => l.subject === subject)) return d;
  }
  return null;
}

/* --- разбор ответа ЛКС (устойчив к разным форматам) --- */

const DAY_NAMES = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7, пон: 1, вто: 2, сре: 3, чет: 4, пят: 5, суб: 6, вос: 7 };

function parseDay(v) {
  if (typeof v === 'number') return v >= 1 && v <= 7 ? v : null;
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return parseDay(Number(v));
    return DAY_NAMES[v.trim().toLowerCase().slice(0, 3)] || null;
  }
  return null;
}

function parseWeek(v) {
  const s = String(v ?? '').toLowerCase();
  if (/^(ch|чс|чис|num|odd)/.test(s)) return 'ch';
  if (/^(zn|зн|den|even)/.test(s)) return 'zn';
  return 'all';
}

function parseType(v) {
  const s = String(v ?? '').toLowerCase();
  if (/lec|лек/.test(s)) return 'lecture';
  if (/lab|лаб/.test(s)) return 'lab';
  if (/sem|сем|prac|пр/.test(s)) return 'seminar';
  return 'other';
}

function teacherName(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  const last = t.lastName || t.last_name || t.surname || '';
  const first = t.firstName || t.first_name || t.name || '';
  const middle = t.middleName || t.middle_name || t.patronymic || '';
  if (!last) return t.fullName || t.name || '';
  return `${last} ${first ? first[0] + '.' : ''}${middle ? middle[0] + '.' : ''}`.trim();
}

function normalizeLesson(x, dayFallback) {
  const d = x.discipline;
  const subject = (typeof d === 'string' ? d : d && (d.fullName || d.full_name || d.name || d.abbr))
    || x.subject || x.title || x.name;
  if (!subject) return null;
  const day = parseDay(x.day ?? x.weekday ?? x.dayOfWeek ?? dayFallback);
  if (!day) return null;
  let slot = Number(x.time ?? x.slot ?? x.pair ?? x.lessonNumber) || 0;
  let start = x.startTime || x.start || x.timeStart || '';
  let end = x.endTime || x.end || x.timeEnd || '';
  if (typeof x.time === 'string' && x.time.includes(':')) start = x.time.slice(0, 5);
  start = String(start).slice(0, 5);
  end = String(end).slice(0, 5);
  if (!slot && start) slot = SLOTS.findIndex((s) => s.start === start) + 1;
  if (slot >= 1 && slot <= SLOTS.length) {
    if (!start || !start.includes(':')) start = SLOTS[slot - 1].start;
    if (!end || !end.includes(':')) end = SLOTS[slot - 1].end;
  }
  if (!start.includes(':')) return null;
  if (!end.includes(':')) end = fromMin(toMin(start) + 90);
  const rooms = x.audiences || x.audience || x.rooms || x.room || x.cabinet || [];
  const room = Array.isArray(rooms)
    ? rooms.map((a) => (typeof a === 'string' ? a : a && (a.name || a.number || a.title))).filter(Boolean).join(', ')
    : String(rooms || '');
  const teachers = x.teachers || x.teacher || [];
  const teacher = Array.isArray(teachers) ? teachers.map(teacherName).filter(Boolean).join(', ') : teacherName(teachers);
  return {
    id: uid(),
    day,
    slot: slot || null,
    start,
    end,
    week: parseWeek(x.week ?? x.weekType ?? x.parity),
    subject: String(subject).trim(),
    type: parseType((d && (d.actType || d.act_type)) || x.actType || x.type || x.kind),
    room,
    teacher,
  };
}

function findLessonArray(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (Array.isArray(obj)) {
    const looksLike = (x) => x && typeof x === 'object' && ('day' in x || 'weekday' in x) && ('discipline' in x || 'subject' in x || 'lessons' in x || 'name' in x);
    if (obj.length && obj.some(looksLike)) return obj;
    for (const x of obj) { const r = findLessonArray(x, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of ['lessons', 'schedule', 'data', 'raw', 'items', 'days']) {
      if (obj[k]) { const r = findLessonArray(obj[k], depth + 1); if (r) return r; }
    }
  }
  return null;
}

function normalizeSchedule(json) {
  const arr = findLessonArray(json);
  if (!arr) return [];
  const out = [];
  for (const x of arr) {
    if (Array.isArray(x.lessons)) x.lessons.forEach((l) => { const n = normalizeLesson(l, x.day ?? x.weekday); if (n) out.push(n); });
    else { const n = normalizeLesson(x); if (n) out.push(n); }
  }
  // убираем дубли (одна пара у нескольких подгрупп)
  const seen = new Set();
  return out.filter((l) => {
    const key = [l.day, l.start, l.week, l.subject, l.type, l.room].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applySchedule(lessons, meta) {
  const manual = state.schedule.lessons.filter((l) => l.manual);
  state.schedule = {
    lessons: [...lessons, ...manual],
    updatedAt: new Date().toISOString(),
    fetchedAt: meta.fetchedAt || new Date().toISOString(),
    source: meta.source,
    title: meta.title || state.schedule.title || '',
  };
  if (meta.uuid && !state.settings.lksUuid) state.settings.lksUuid = meta.uuid;
  save();
}

function extractUuid(s) {
  const m = String(s || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : '';
}

async function fetchJson(url, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// 1) schedule.json рядом с приложением (его обновляет GitHub Actions)
// 2) напрямую из ЛКС (сработает, только если ЛКС разрешит запрос из браузера)
async function refreshSchedule({ silent = false, force = false } = {}) {
  const errors = [];
  try {
    const json = await fetchJson('schedule.json?t=' + Date.now());
    const lessons = normalizeSchedule(json);
    if (lessons.length) {
      const fetchedAt = json.fetchedAt || null;
      const groupOk = !json.group || !state.settings.group || norm(json.group) === norm(state.settings.group);
      const hasAuto = state.schedule.lessons.some((l) => !l.manual);
      const newer = state.schedule.source === 'github' && fetchedAt && (!state.schedule.fetchedAt || fetchedAt > state.schedule.fetchedAt);
      if (groupOk && (force || !hasAuto || newer)) {
        applySchedule(lessons, { source: 'github', fetchedAt, uuid: json.uuid, title: json.title });
        toast('Расписание обновлено');
        render();
        return true;
      }
      if (groupOk) { if (!silent) toast('Расписание уже актуально'); return true; }
      errors.push(`в schedule.json группа ${json.group}`);
    } else errors.push('schedule.json пуст');
  } catch (e) { errors.push('schedule.json недоступен'); }

  const uuid = state.settings.lksUuid;
  if (uuid) {
    try {
      const json = await fetchJson(`${LKS_API}/schedules/groups/${uuid}/public`);
      const lessons = normalizeSchedule(json);
      if (lessons.length) {
        applySchedule(lessons, { source: 'lks', uuid });
        toast('Расписание загружено из ЛКС');
        render();
        return true;
      }
      errors.push('в ответе ЛКС нет пар');
    } catch (e) { errors.push('ЛКС не отвечает браузеру'); }
  }
  if (!silent) toast('Не получилось: ' + errors.join(', '));
  return false;
}

const norm = (s) => String(s || '').toUpperCase().replace(/\s/g, '').replace(/\/?6$/, 'Б');

/* ---------------- задачи ---------------- */

function taskSort(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (!!a.important !== !!b.important) return a.important ? -1 : 1;
  if ((a.time || '') !== (b.time || '')) return (a.time || '99') < (b.time || '99') ? -1 : 1;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

function tasksOn(s) { return state.tasks.filter((t) => t.date === s).sort(taskSort); }
function overdue() { const t = todayISO(); return state.tasks.filter((x) => !x.done && x.date < t).sort((a, b) => a.date.localeCompare(b.date) || taskSort(a, b)); }

function upsertTask(d) {
  const existing = d.id && state.tasks.find((t) => t.id === d.id);
  const clean = {
    title: d.title.trim(),
    note: (d.note || '').trim(),
    date: d.date,
    time: d.time || '',
    subject: d.subject || '',
    important: !!d.important,
  };
  if (existing) Object.assign(existing, clean);
  else state.tasks.push({ id: uid(), done: false, createdAt: Date.now(), ...clean });
  save();
}

function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  save();
  if (t.done && navigator.vibrate) navigator.vibrate(10);
}

function deleteTask(id) {
  const idx = state.tasks.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const [removed] = state.tasks.splice(idx, 1);
  save();
  toast('Задача удалена', () => { state.tasks.splice(idx, 0, removed); save(); render(); });
}

/* ---------------- отрисовка: общие куски ---------------- */

const CHECK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV_SVG = '<svg class="chev" viewBox="0 0 24 24" width="18" height="18"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function taskHTML(t, opts = {}) {
  const sub = [];
  if (t.important) sub.push('<span class="flag">!</span>');
  if (t.subject) sub.push(`<span class="subj" style="--c:${subjectColor(t.subject)}">${esc(t.subject)}</span>`);
  if (opts.showDate) {
    const late = !t.done && t.date < todayISO();
    sub.push(`<span class="${late ? 'late' : ''}">${t.subject ? 'к ' : ''}${esc(fmtRel(t.date))}</span>`);
  }
  if (t.time) sub.push(`<span>${esc(t.time)}</span>`);
  return `
    <div class="task ${t.done ? 'done' : ''}">
      <button class="check" data-action="toggle" data-id="${t.id}" aria-label="Выполнено">${CHECK_SVG}</button>
      <div class="body" data-action="edit-task" data-id="${t.id}">
        <div class="title">${esc(t.title)}</div>
        ${sub.length ? `<div class="sub">${sub.join('<span>·</span>')}</div>` : ''}
        ${t.note && !opts.hideNote ? `<div class="note">${esc(t.note)}</div>` : ''}
      </div>
    </div>`;
}

function lessonHTML(l, opts = {}) {
  const type = LESSON_TYPES[l.type] || LESSON_TYPES.other;
  const meta = [];
  if (l.room) meta.push(`<span>${esc(l.room)}</span>`);
  if (l.teacher) meta.push(`<span>${esc(l.teacher)}</span>`);
  if (opts.showWeek && l.week !== 'all') meta.push(`<span>${l.week === 'ch' ? 'числитель' : 'знаменатель'}</span>`);
  const hw = opts.hwCount ? `<span class="hwcount">ДЗ ${opts.hwCount}</span>` : '';
  return `
    <button class="lesson ${opts.status || ''}" style="--c:${subjectColor(l.subject)}" data-action="open-lesson" data-id="${l.id}" ${opts.date ? `data-date="${opts.date}"` : ''}>
      <div class="time"><span>${l.start}</span><span>${l.end}</span></div>
      <div class="bar"></div>
      <div class="body">
        ${opts.status === 'now' ? `<div class="now-label">Сейчас · до ${l.end}</div>` : ''}
        <div class="name">${esc(l.subject)}</div>
        <div class="meta">${type.tag ? `<span class="tag">${type.tag}</span>` : ''}${meta.join('')}</div>
      </div>
      ${hw}
    </button>`;
}

function emptyHTML(icon, text, extra = '') {
  return `<div class="card"><div class="empty"><div class="big">${icon}</div>${text}${extra}</div></div>`;
}

/* ---------------- вкладка «День» ---------------- */

function renderDay() {
  const s = ui.date;
  const today = todayISO();
  const isToday = s === today;
  const w = weekInfo(s);
  const dow = dowIdx(s);

  // полоса недели
  const mon = mondayOf(s);
  let strip = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const active = state.tasks.filter((t) => t.date === d && !t.done);
    const dots = active.slice(0, 3).map((t) => `<i class="${t.subject ? 'hw' : ''}"></i>`).join('');
    strip += `
      <button class="${d === today ? 'today' : ''} ${d === s ? 'selected' : ''}" data-action="pick-date" data-date="${d}">
        <span class="dow">${DOW_SHORT[i]}</span>
        <span class="num">${parse(d).getDate()}</span>
        <span class="dots">${dots}</span>
      </button>`;
  }
  const monthLabel = MONTHS_NOM[parse(s).getMonth()];

  // пары
  const lessons = lessonsFor(s);
  let lessonsHTML = '';
  if (!state.schedule.lessons.length) {
    lessonsHTML = emptyHTML('📚', 'Расписание ещё не загружено', `<button class="btn secondary" data-action="refresh-schedule">Загрузить расписание</button><button class="btn secondary" data-tab="settings" style="margin-top:8px">Настроить вручную</button>`);
  } else if (!lessons.length) {
    lessonsHTML = emptyHTML(dow === 6 ? '😴' : '🎉', w.inSemester ? 'Пар нет — свободный день' : 'Вне учебного семестра');
  } else {
    const nm = nowMinutes();
    let html = '';
    lessons.forEach((l, i) => {
      if (i > 0) {
        const gap = toMin(l.start) - toMin(lessons[i - 1].end);
        if (gap >= 40) html += `<div class="break">Окно · ${fmtDuration(gap)}</div>`;
      }
      let status = '';
      if (isToday) {
        if (nm >= toMin(l.end)) status = 'past';
        else if (nm >= toMin(l.start)) status = 'now';
      }
      const hwCount = state.tasks.filter((t) => !t.done && t.subject === l.subject && t.date === s).length;
      html += lessonHTML(l, { status, hwCount, date: s });
    });
    lessonsHTML = `<div class="card">${html}</div>`;
  }

  let lessonsSub = '';
  if (lessons.length) {
    lessonsSub = `${lessons.length} ${plural(lessons.length, 'пара', 'пары', 'пар')} · ${lessons[0].start}–${lessons[lessons.length - 1].end}`;
    if (isToday) {
      const nm = nowMinutes();
      const next = lessons.find((l) => toMin(l.start) > nm);
      const cur = lessons.find((l) => toMin(l.start) <= nm && nm < toMin(l.end));
      if (!cur && next) lessonsSub = `следующая через ${fmtDuration(toMin(next.start) - nm)}`;
      else if (!cur && !next) lessonsSub = 'пары закончились';
    }
  }

  // задачи
  const list = tasksOn(s);
  const done = list.filter((t) => t.done).length;
  const late = isToday ? overdue() : [];

  let tasksHTML = '';
  if (late.length) {
    tasksHTML += `<div class="section-title danger">Просрочено <small>${late.length}</small></div>
      <div class="card">${late.map((t) => taskHTML(t, { showDate: true })).join('')}</div>`;
  }
  tasksHTML += `<div class="section-title">${isToday ? 'Дела на сегодня' : 'Дела'} <small>${list.length ? `${done} из ${list.length}` : ''}</small></div>`;
  tasksHTML += list.length
    ? `<div class="card">${list.map((t) => taskHTML(t)).join('')}</div>`
    : emptyHTML('✨', 'Ничего не запланировано.<br>Нажми <b>+</b>, чтобы добавить дело или домашку.');

  const weekLabel = w.inSemester
    ? `<span class="pill">${w.n} неделя</span><span class="pill gray">${w.numerator ? 'Числитель' : 'Знаменатель'}</span>`
    : '';

  return `
    <div class="fade-in">
      <div class="header">
        <div>
          <h1>${isToday ? 'Сегодня' : DOW_FULL[dow]}</h1>
          <div class="subtitle">${isToday ? DOW_FULL[dow] + ', ' : ''}${fmtDay(s)} ${weekLabel}</div>
        </div>
        ${isToday ? '' : '<button class="link-btn" data-action="go-today">Сегодня</button>'}
      </div>
      <div class="strip-nav">
        <button data-action="shift-week" data-n="-1">‹ Пред.</button>
        <span>${monthLabel}</span>
        <button data-action="shift-week" data-n="1">След. ›</button>
      </div>
      <div class="strip" id="strip">${strip}</div>
      <div class="section-title">Пары <small>${lessonsSub}</small></div>
      ${lessonsHTML}
      ${tasksHTML}
    </div>`;
}

/* ---------------- вкладка «Домашка» ---------------- */

function renderHW() {
  const hw = state.tasks.filter((t) => t.subject);
  const active = hw.filter((t) => !t.done);
  const today = todayISO();
  const tomorrow = addDays(today, 1);
  const sunday = addDays(mondayOf(today), 6);

  let body = '';
  if (ui.hwMode === 'due') {
    const groups = [
      { title: 'Просрочено', cls: 'danger', items: active.filter((t) => t.date < today) },
      { title: 'К сегодня', items: active.filter((t) => t.date === today) },
      { title: 'К завтра', items: active.filter((t) => t.date === tomorrow) },
      { title: 'На этой неделе', items: active.filter((t) => t.date > tomorrow && t.date <= sunday) },
      { title: 'Позже', items: active.filter((t) => t.date > sunday && t.date > tomorrow) },
    ];
    for (const g of groups) {
      if (!g.items.length) continue;
      g.items.sort((a, b) => a.date.localeCompare(b.date) || taskSort(a, b));
      body += `<div class="section-title ${g.cls || ''}">${g.title} <small>${g.items.length}</small></div>
        <div class="card">${g.items.map((t) => taskHTML(t, { showDate: true })).join('')}</div>`;
    }
    if (!active.length) body += emptyHTML('🎓', 'Вся домашка сделана!<br>Добавь новую через <b>+</b> или нажав на пару.');
    const doneList = hw.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    if (doneList.length) {
      body += `<div class="section-title"><span>Выполнено <small>${doneList.length}</small></span>
        <button class="link-btn" data-action="toggle-done">${ui.showDone ? 'Скрыть' : 'Показать'}</button></div>`;
      if (ui.showDone) body += `<div class="card">${doneList.slice(0, 50).map((t) => taskHTML(t, { showDate: true })).join('')}</div>`;
    }
  } else {
    const subjects = allSubjects();
    if (!subjects.length) body = emptyHTML('📚', 'Предметы появятся, когда загрузится расписание.');
    else {
      body = '<div class="card">' + subjects.map((name) => {
        const items = hw.filter((t) => t.subject === name);
        const act = items.filter((t) => !t.done).sort((a, b) => a.date.localeCompare(b.date));
        const open = ui.openSubjects.has(name);
        const next = nextLessonDate(name);
        let inner = '';
        if (open) {
          inner = act.map((t) => taskHTML(t, { showDate: true })).join('');
          const doneItems = items.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 3);
          inner += doneItems.map((t) => taskHTML(t, { showDate: true })).join('');
          inner += `<button class="row accent" data-action="add-hw" data-subject="${esc(name)}">＋ Добавить ДЗ${next ? ` к ${esc(fmtRel(next))}` : ''}</button>`;
        }
        return `
          <button class="subject-row ${open ? 'open' : ''}" style="--c:${subjectColor(name)}" data-action="toggle-subject" data-subject="${esc(name)}">
            <span class="dot"></span><span class="name">${esc(name)}</span>
            <span class="count">${act.length || ''}</span>${CHEV_SVG}
          </button>${inner}`;
      }).join('') + '</div>';
    }
  }

  return `
    <div class="fade-in">
      <div class="header"><div>
        <h1>Домашка</h1>
        <div class="subtitle">${active.length ? `${active.length} ${plural(active.length, 'задание', 'задания', 'заданий')} не сделано` : 'всё сделано'}</div>
      </div></div>
      <div class="segmented">
        <button class="${ui.hwMode === 'due' ? 'active' : ''}" data-action="hw-mode" data-mode="due">По сроку</button>
        <button class="${ui.hwMode === 'subject' ? 'active' : ''}" data-action="hw-mode" data-mode="subject">По предметам</button>
      </div>
      ${body}
    </div>`;
}

/* ---------------- вкладка «Расписание» ---------------- */

function renderWeek() {
  const today = todayISO();
  const w = weekInfo(today);
  if (ui.weekParity === null) ui.weekParity = w.numerator ? 'ch' : 'zn';
  const numerator = ui.weekParity === 'ch';
  const thisWeek = numerator === w.numerator;

  let body = '';
  if (!state.schedule.lessons.length) {
    body = emptyHTML('🗓️', 'Расписание пустое', '<button class="btn" data-action="refresh-schedule">Загрузить из ЛКС</button><button class="btn secondary" data-action="add-lesson" style="margin-top:8px">Добавить пару вручную</button>');
  } else {
    for (let day = 1; day <= 6; day++) {
      const ls = lessonsForWeekday(day, numerator);
      const isToday = thisWeek && dowIdx(today) + 1 === day;
      body += `<div class="day-block"><h3 class="${isToday ? 'today' : ''}">${DOW_FULL[day - 1]}${isToday ? ' · сегодня' : ''}</h3>
        ${ls.length ? `<div class="card">${ls.map((l) => lessonHTML(l)).join('')}</div>` : '<div class="card"><div class="empty" style="padding:14px">Нет пар</div></div>'}
      </div>`;
    }
    body += '<button class="btn secondary" data-action="add-lesson">＋ Добавить пару вручную</button>';
  }

  const upd = state.schedule.fetchedAt ? new Date(state.schedule.fetchedAt) : null;
  return `
    <div class="fade-in">
      <div class="header">
        <div>
          <h1>Расписание</h1>
          <div class="subtitle">${esc(state.settings.group)}${upd ? ` · обновлено ${upd.getDate()} ${MONTHS_SHORT[upd.getMonth()]}` : ''}</div>
        </div>
        <button class="link-btn" data-action="refresh-schedule">Обновить</button>
      </div>
      <div class="segmented">
        <button class="${numerator ? 'active' : ''}" data-action="parity" data-p="ch">Числитель${w.numerator ? ' · сейчас' : ''}</button>
        <button class="${!numerator ? 'active' : ''}" data-action="parity" data-p="zn">Знаменатель${!w.numerator ? ' · сейчас' : ''}</button>
      </div>
      ${body}
    </div>`;
}

/* ---------------- вкладка «Ещё» ---------------- */

function renderSettings() {
  const s = state.settings;
  const w = weekInfo(todayISO());
  const doneCount = state.tasks.filter((t) => t.done).length;
  const srcLabel = { github: 'автоматически (GitHub)', lks: 'из ЛКС', manual: 'вручную', paste: 'вставлено вручную' }[state.schedule.source] || 'не загружено';
  return `
    <div class="fade-in">
      <div class="header"><div><h1>Ещё</h1></div></div>

      <div class="list-label">Учёба</div>
      <div class="list">
        <label class="row"><span class="label">Группа</span><input type="text" data-setting="group" value="${esc(s.group)}" autocapitalize="characters"></label>
        <label class="row"><span class="label">Начало семестра</span><input type="date" data-setting="semesterStart" value="${esc(s.semesterStart)}"></label>
        <label class="row"><span class="label">Недель в семестре</span><input type="number" inputmode="numeric" data-setting="weeks" value="${esc(s.weeks)}" style="max-width:70px"></label>
        <div class="row"><span class="label">Сейчас</span><span class="value">${w.inSemester ? `${w.n} неделя, ${w.numerator ? 'числитель' : 'знаменатель'}` : 'вне семестра'}</span></div>
      </div>
      <div class="list-foot">Первая неделя семестра — числитель. Если чётность не совпадает с ЛКС, поправь дату начала семестра.</div>

      <div class="list-label">Расписание</div>
      <div class="list">
        <div class="row"><span class="label">Источник</span><span class="value">${srcLabel} · ${state.schedule.lessons.length} пар</span></div>
        <button class="row accent" data-action="refresh-schedule">Обновить расписание</button>
        <label class="row"><span class="label">Ссылка ЛКС</span><input type="text" data-setting="lksUuid" placeholder="вставь ссылку" value="${esc(s.lksUuid)}"></label>
        <button class="row accent" data-action="open-lks">Открыть расписание в ЛКС</button>
        <button class="row accent" data-action="paste-schedule">Вставить расписание (JSON)</button>
        <button class="row accent" data-action="add-lesson">Добавить пару вручную</button>
        <button class="row danger" data-action="clear-schedule">Очистить расписание</button>
      </div>
      <div class="list-foot">Расписание подтягивается само из ЛКС раз в день. Если не вышло: открой своё расписание на lks.bmstu.ru, скопируй ссылку из адресной строки в поле «Ссылка ЛКС», нажми «Открыть расписание в ЛКС», скопируй весь текст страницы и вставь через «Вставить расписание».</div>

      <div class="list-label">Данные</div>
      <div class="list">
        <button class="row accent" data-action="export">Сохранить резервную копию</button>
        <label class="row accent">Восстановить из копии<input type="file" accept="application/json,.json" data-action-change="import"></label>
        <button class="row danger" data-action="clear-done" ${doneCount ? '' : 'disabled'}>Удалить выполненные (${doneCount})</button>
      </div>
      <div class="list-foot">Все задачи хранятся только на этом телефоне. Время от времени сохраняй резервную копию в «Файлы».</div>

      <div class="list-label">Как установить на iPhone</div>
      <div class="list"><div class="row" style="display:block;line-height:1.5;font-size:15px">
        1. Открой эту страницу в <b>Safari</b>.<br>
        2. Нажми «Поделиться» <b>⎋</b> внизу экрана.<br>
        3. Выбери «<b>На экран «Домой»</b>» → «Добавить».<br>
        Иконка «Учёба» появится рядом с остальными приложениями и будет работать даже без интернета.
      </div></div>
      <div class="list-foot" style="text-align:center;margin-top:20px">Ежедневник МГТУ · v1.0</div>
    </div>`;
}

/* ---------------- главный рендер ---------------- */

const view = document.getElementById('view');
const fab = document.getElementById('fab');

function render() {
  const scroll = window.scrollY;
  const renderers = { day: renderDay, hw: renderHW, week: renderWeek, settings: renderSettings };
  view.innerHTML = renderers[ui.tab]();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  fab.classList.toggle('hidden', ui.tab === 'settings' || ui.tab === 'week');
  window.scrollTo(0, scroll);
}

function switchTab(tab) {
  if (ui.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); if (tab === 'day') { ui.date = todayISO(); render(); } return; }
  ui.tab = tab;
  render();
  window.scrollTo(0, 0);
}

/* ---------------- шторка (bottom sheet) ---------------- */

const sheet = document.getElementById('sheet');
const backdrop = document.getElementById('backdrop');
let sheetRender = null;

function openSheet(renderFn) {
  sheetRender = renderFn;
  sheet.innerHTML = '<div class="grabber"></div>' + renderFn();
  sheet.scrollTop = 0;
  requestAnimationFrame(() => { sheet.classList.add('open'); backdrop.classList.add('open'); });
}
function rerenderSheet() { if (sheetRender) sheet.innerHTML = '<div class="grabber"></div>' + sheetRender(); }
function closeSheet() {
  sheet.classList.remove('open');
  backdrop.classList.remove('open');
  document.activeElement && document.activeElement.blur();
  sheetRender = null;
  ui.draft = null;
  ui.lessonDraft = null;
}

// смахивание шторки вниз
(() => {
  let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', (e) => { if (sheet.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 === null) return;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 110) closeSheet();
    y0 = null;
  });
})();

/* --- редактор задачи --- */

function openTaskEditor(preset = {}) {
  const existing = preset.id && state.tasks.find((t) => t.id === preset.id);
  ui.draft = existing ? { ...existing } : {
    title: '', note: '', time: '', important: false,
    date: preset.date || (ui.tab === 'day' ? ui.date : todayISO()),
    subject: preset.subject || '',
  };
  if (!existing && preset.subject && !preset.date) {
    ui.draft.date = nextLessonDate(preset.subject) || addDays(todayISO(), 1);
  }
  openSheet(taskEditorHTML);
  if (!existing) setTimeout(() => { const i = sheet.querySelector('[data-field="title"]'); i && i.focus(); }, 50);
}

function taskEditorHTML() {
  const d = ui.draft;
  const isEdit = !!d.id;
  const today = todayISO();
  const base = today;

  // предметы
  const subjects = allSubjects().sort((x, y) => (y === d.subject) - (x === d.subject));
  const subjChips = [`<button class="chip ${!d.subject ? 'active' : ''}" data-action="draft-subject" data-subject="">Без предмета</button>`]
    .concat(subjects.map((n) => `<button class="chip subject ${d.subject === n ? 'active' : ''}" style="--c:${subjectColor(n)}" data-action="draft-subject" data-subject="${esc(n)}">${esc(n)}</button>`))
    .join('');

  // даты
  const quick = [];
  const nextL = d.subject ? nextLessonDate(d.subject, today) : null;
  if (nextL) quick.push({ date: nextL, label: `К след. паре · ${fmtRel(nextL)}` });
  for (let i = 0; i < 7; i++) {
    const ds = addDays(base, i);
    if (quick.some((q) => q.date === ds)) continue;
    quick.push({ date: ds, label: i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : `${DOW_SHORT[dowIdx(ds)]}, ${parse(ds).getDate()}` });
  }
  const custom = !quick.some((q) => q.date === d.date);
  const dateChips = quick.map((q) => `<button class="chip ${d.date === q.date ? 'active' : ''}" data-action="draft-date" data-date="${q.date}">${esc(q.label)}</button>`).join('')
    + `<label class="chip ${custom ? 'active' : ''}">📅 ${custom ? esc(fmtRel(d.date)) : 'Другая дата'}<input type="date" data-field="date" value="${d.date}"></label>`;

  // время
  const dayLessons = lessonsFor(d.date);
  const beforeTime = dayLessons.length ? fromMin(toMin(dayLessons[0].start) - 15) : null;
  const afterTime = dayLessons.length ? dayLessons[dayLessons.length - 1].end : null;
  const timeChips = [
    `<button class="chip ${!d.time ? 'active' : ''}" data-action="draft-time" data-time="">Без времени</button>`,
    beforeTime ? `<button class="chip ${d.time === beforeTime ? 'active' : ''}" data-action="draft-time" data-time="${beforeTime}">Перед парами · ${beforeTime}</button>` : '',
    afterTime ? `<button class="chip ${d.time === afterTime ? 'active' : ''}" data-action="draft-time" data-time="${afterTime}">После пар · ${afterTime}</button>` : '',
    `<label class="chip ${d.time && d.time !== beforeTime && d.time !== afterTime ? 'active' : ''}">🕒 ${d.time && d.time !== beforeTime && d.time !== afterTime ? d.time : 'Выбрать'}<input type="time" data-field="time" value="${d.time}"></label>`,
  ].join('');

  return `
    <div class="sheet-head">
      <button data-action="close-sheet">Отмена</button>
      <h2>${isEdit ? 'Изменить' : d.subject ? 'Домашка' : 'Новое дело'}</h2>
      <button class="primary" data-action="save-task" ${d.title.trim() ? '' : 'disabled'}>Готово</button>
    </div>
    <div class="field"><input type="text" class="big" data-field="title" placeholder="${d.subject ? 'Что задали?' : 'Что нужно сделать?'}" value="${esc(d.title)}" enterkeyhint="done" autocomplete="off"></div>
    <div class="field"><textarea data-field="note" placeholder="Заметка (номера задач, страницы…)" rows="2">${esc(d.note)}</textarea></div>

    <div class="field-label">Предмет</div>
    <div class="chips">${subjChips}</div>

    <div class="field-label">${d.subject ? 'Сдать / сделать к' : 'Когда'}</div>
    <div class="chips">${dateChips}</div>

    <div class="field-label">Время</div>
    <div class="chips">${timeChips}</div>

    <div class="field-label">Приоритет</div>
    <div class="chips"><button class="chip ${d.important ? 'active' : ''}" data-action="draft-important">❗ Важно</button></div>

    ${isEdit ? `
      <button class="btn secondary" data-action="toggle-from-editor">${d.done ? 'Вернуть в работу' : '✓ Отметить выполненным'}</button>
      <button class="btn danger" data-action="delete-task" data-id="${d.id}">Удалить</button>` : ''}
  `;
}

/* --- карточка пары --- */

function openLessonSheet(id, date) {
  const l = state.schedule.lessons.find((x) => x.id === id);
  if (!l) return;
  openSheet(() => {
    const type = LESSON_TYPES[l.type] || LESSON_TYPES.other;
    const hw = state.tasks.filter((t) => t.subject === l.subject && !t.done).sort((a, b) => a.date.localeCompare(b.date));
    // к будущей паре — на её дату; к уже начавшейся — на следующую пару по предмету
    const today = todayISO();
    const started = date === today && nowMinutes() >= toMin(l.start);
    const target = date && date >= today && !started ? date : nextLessonDate(l.subject, date && date > today ? date : today);
    const weekLabel = { all: 'каждую неделю', ch: 'по числителям', zn: 'по знаменателям' }[l.week];
    return `
      <div class="sheet-head">
        <button data-action="close-sheet">Закрыть</button>
        <h2>${type.label}</h2>
        <button class="primary" data-action="edit-lesson" data-id="${l.id}">Изменить</button>
      </div>
      <div style="font-size:22px;font-weight:700;margin:4px 4px 14px;color:${subjectColor(l.subject)}">${esc(l.subject)}</div>
      <div class="info-grid">
        <div class="row"><span class="label">Время</span><span class="value">${DOW_SHORT[l.day - 1]}, ${l.start}–${l.end}${l.slot ? ` · ${l.slot} пара` : ''}</span></div>
        <div class="row"><span class="label">Неделя</span><span class="value">${weekLabel}</span></div>
        ${l.room ? `<div class="row"><span class="label">Аудитория</span><span class="value">${esc(l.room)}</span></div>` : ''}
        ${l.teacher ? `<div class="row"><span class="label">Преподаватель</span><span class="value">${esc(l.teacher)}</span></div>` : ''}
      </div>
      <div class="field-label">Домашка по предмету</div>
      ${hw.length ? `<div class="card">${hw.map((t) => taskHTML(t, { showDate: true })).join('')}</div>` : '<div class="card"><div class="empty" style="padding:16px">Ничего не задано</div></div>'}
      <button class="btn" data-action="add-hw" data-subject="${esc(l.subject)}" ${target ? `data-date="${target}"` : ''}>＋ Добавить ДЗ${target ? ` к ${esc(fmtRel(target))}` : ''}</button>
    `;
  });
}

/* --- редактор пары --- */

function openLessonEditor(id) {
  const l = id && state.schedule.lessons.find((x) => x.id === id);
  ui.lessonDraft = l ? { ...l } : { subject: '', type: 'lecture', day: Math.min(dowIdx(todayISO()) + 1, 6), slot: 1, week: 'all', room: '', teacher: '' };
  openSheet(lessonEditorHTML);
}

function lessonEditorHTML() {
  const d = ui.lessonDraft;
  const chip = (action, key, val, label, active) => `<button class="chip ${active ? 'active' : ''}" data-action="${action}" data-key="${key}" data-val="${val}">${label}</button>`;
  const existing = allSubjects().filter((n) => n !== d.subject).slice(0, 12);
  return `
    <div class="sheet-head">
      <button data-action="close-sheet">Отмена</button>
      <h2>${d.id ? 'Пара' : 'Новая пара'}</h2>
      <button class="primary" data-action="save-lesson" ${d.subject.trim() ? '' : 'disabled'}>Готово</button>
    </div>
    <div class="field"><input type="text" class="big" data-lfield="subject" placeholder="Предмет" value="${esc(d.subject)}" autocomplete="off"></div>
    ${existing.length && !d.id ? `<div class="chips" style="margin-bottom:6px">${existing.map((n) => `<button class="chip" data-action="ldraft" data-key="subject" data-val="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
    <div class="field-label">Тип</div>
    <div class="chips">${Object.entries(LESSON_TYPES).map(([k, v]) => chip('ldraft', 'type', k, v.label, d.type === k)).join('')}</div>
    <div class="field-label">День</div>
    <div class="chips">${DOW_SHORT.slice(0, 6).map((n, i) => chip('ldraft', 'day', i + 1, n, d.day === i + 1)).join('')}</div>
    <div class="field-label">Пара</div>
    <div class="chips">${SLOTS.map((s, i) => chip('ldraft', 'slot', i + 1, `${i + 1} · ${s.start}`, d.slot === i + 1)).join('')}</div>
    <div class="field-label">Неделя</div>
    <div class="chips">${chip('ldraft', 'week', 'all', 'Каждую', d.week === 'all')}${chip('ldraft', 'week', 'ch', 'Числитель', d.week === 'ch')}${chip('ldraft', 'week', 'zn', 'Знаменатель', d.week === 'zn')}</div>
    <div class="field-label">Где и кто</div>
    <div class="field"><input type="text" data-lfield="room" placeholder="Аудитория, например 345ю" value="${esc(d.room)}"></div>
    <div class="field"><input type="text" data-lfield="teacher" placeholder="Преподаватель" value="${esc(d.teacher)}"></div>
    ${d.id ? '<button class="btn danger" data-action="delete-lesson">Удалить пару</button>' : ''}
  `;
}

function saveLesson() {
  const d = ui.lessonDraft;
  if (!d.subject.trim()) return;
  const slot = SLOTS[(d.slot || 1) - 1];
  const lesson = { ...d, subject: d.subject.trim(), start: slot.start, end: slot.end, manual: true };
  if (d.id) {
    const idx = state.schedule.lessons.findIndex((x) => x.id === d.id);
    if (idx >= 0) state.schedule.lessons[idx] = lesson;
  } else {
    lesson.id = uid();
    state.schedule.lessons.push(lesson);
    if (!state.schedule.source) state.schedule.source = 'manual';
  }
  save();
  closeSheet();
  render();
}

/* --- вставка расписания --- */

function openPasteSheet() {
  openSheet(() => `
    <div class="sheet-head">
      <button data-action="close-sheet">Отмена</button>
      <h2>Вставить расписание</h2>
      <button class="primary" data-action="apply-paste">Готово</button>
    </div>
    <div class="list-foot" style="margin:0 4px 10px">Вставь сюда весь текст, который открылся по кнопке «Открыть расписание в ЛКС» (Выделить всё → Скопировать).</div>
    <div class="field"><textarea id="paste-area" rows="10" placeholder='{"data": ...}' style="font-family:ui-monospace,monospace;font-size:13px"></textarea></div>
  `);
}

/* ---------------- toast ---------------- */

const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg, undo) {
  toastEl.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-action="undo">Отменить</button>' : ''}`;
  toastEl._undo = undo || null;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), undo ? 4500 : 2600);
}

/* ---------------- резервная копия ---------------- */

async function exportData() {
  const data = JSON.stringify({ app: 'bmstu-planner', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2);
  const name = `planner-${todayISO()}.json`;
  const file = new File([data], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Резервная копия ежедневника' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.tasks)) throw new Error('bad');
      if (!confirm(`Восстановить ${data.tasks.length} задач из копии? Текущие данные будут заменены.`)) return;
      const d = defaultState();
      state = {
        tasks: data.tasks,
        settings: { ...d.settings, ...(data.settings || {}) },
        schedule: { ...d.schedule, ...(data.schedule || {}) },
      };
      save();
      render();
      toast('Данные восстановлены');
    } catch (e) { toast('Это не похоже на резервную копию'); }
  };
  reader.readAsText(file);
}

/* ---------------- обработчики ---------------- */

const actions = {
  'quick-add': () => openTaskEditor(),
  'close-sheet': closeSheet,
  'undo': () => { const u = toastEl._undo; toastEl.classList.remove('show'); u && u(); },

  'pick-date': (el) => { ui.date = el.dataset.date; render(); },
  'go-today': () => { ui.date = todayISO(); render(); },
  'shift-week': (el) => { ui.date = addDays(ui.date, 7 * Number(el.dataset.n)); render(); },

  'toggle': (el) => {
    const row = el.closest('.task');
    row && row.classList.toggle('done');
    toggleTask(el.dataset.id);
    setTimeout(() => { render(); if (sheetRender) rerenderSheet(); }, 280);
  },
  'edit-task': (el) => openTaskEditor({ id: el.dataset.id }),
  'delete-task': (el) => { closeSheet(); deleteTask(el.dataset.id); render(); },
  'toggle-from-editor': () => { toggleTask(ui.draft.id); closeSheet(); render(); },
  'save-task': () => {
    if (!ui.draft || !ui.draft.title.trim()) return;
    const isNew = !ui.draft.id;
    upsertTask(ui.draft);
    const date = ui.draft.date;
    closeSheet();
    render();
    if (isNew && ui.tab === 'day' && date !== ui.date) toast(`Добавлено на ${fmtRel(date)}`);
  },
  'draft-subject': (el) => {
    const s = el.dataset.subject;
    ui.draft.subject = s;
    if (s && !ui.draft.id) { const n = nextLessonDate(s); if (n) ui.draft.date = n; }
    rerenderSheet();
  },
  'draft-date': (el) => { ui.draft.date = el.dataset.date; rerenderSheet(); },
  'draft-time': (el) => { ui.draft.time = el.dataset.time; rerenderSheet(); },
  'draft-important': () => { ui.draft.important = !ui.draft.important; rerenderSheet(); },

  'open-lesson': (el) => openLessonSheet(el.dataset.id, el.dataset.date),
  'add-hw': (el) => {
    const preset = { subject: el.dataset.subject, date: el.dataset.date };
    if (sheetRender) { closeSheet(); setTimeout(() => openTaskEditor(preset), 60); } else openTaskEditor(preset);
  },
  'edit-lesson': (el) => { closeSheet(); setTimeout(() => openLessonEditor(el.dataset.id), 50); },
  'add-lesson': () => openLessonEditor(),
  'ldraft': (el) => {
    const k = el.dataset.key;
    const v = el.dataset.val;
    ui.lessonDraft[k] = (k === 'day' || k === 'slot') ? Number(v) : v;
    rerenderSheet();
  },
  'save-lesson': saveLesson,
  'delete-lesson': () => {
    if (!confirm('Удалить эту пару из расписания?')) return;
    state.schedule.lessons = state.schedule.lessons.filter((x) => x.id !== ui.lessonDraft.id);
    save(); closeSheet(); render();
  },

  'hw-mode': (el) => { ui.hwMode = el.dataset.mode; render(); },
  'toggle-done': () => { ui.showDone = !ui.showDone; render(); },
  'toggle-subject': (el) => {
    const s = el.dataset.subject;
    ui.openSubjects.has(s) ? ui.openSubjects.delete(s) : ui.openSubjects.add(s);
    render();
  },
  'parity': (el) => { ui.weekParity = el.dataset.p; render(); },

  'refresh-schedule': () => { toast('Обновляю расписание…'); refreshSchedule({ force: true }); },
  'open-lks': () => {
    const uuid = state.settings.lksUuid;
    if (!uuid) { window.open('https://lks.bmstu.ru/schedule', '_blank'); toast('Найди свою группу и скопируй ссылку'); return; }
    window.open(`${LKS_API}/schedules/groups/${uuid}/public`, '_blank');
  },
  'paste-schedule': openPasteSheet,
  'apply-paste': () => {
    const text = document.getElementById('paste-area').value;
    try {
      const lessons = normalizeSchedule(JSON.parse(text));
      if (!lessons.length) throw new Error('empty');
      applySchedule(lessons, { source: 'paste' });
      closeSheet();
      render();
      toast(`Загружено пар: ${lessons.length}`);
    } catch (e) { toast('Не удалось разобрать расписание'); }
  },
  'clear-schedule': () => {
    if (!confirm('Удалить всё расписание? Задачи останутся.')) return;
    state.schedule = defaultState().schedule;
    save(); render();
  },
  'export': exportData,
  'clear-done': () => {
    const n = state.tasks.filter((t) => t.done).length;
    if (!n || !confirm(`Удалить ${n} выполненных задач?`)) return;
    state.tasks = state.tasks.filter((t) => !t.done);
    save(); render();
  },
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { closeSheet(); switchTab(tab.dataset.tab); return; }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});

// поля в шторке
sheet.addEventListener('input', (e) => {
  const f = e.target.dataset.field;
  const lf = e.target.dataset.lfield;
  if (f && ui.draft) {
    ui.draft[f] = e.target.value;
    if (f === 'title') {
      const btn = sheet.querySelector('[data-action="save-task"]');
      if (btn) btn.disabled = !e.target.value.trim();
    }
    if ((f === 'date' && e.target.value) || f === 'time') rerenderSheet();
    if (f === 'date' && !e.target.value) ui.draft.date = todayISO();
  }
  if (lf && ui.lessonDraft) {
    ui.lessonDraft[lf] = e.target.value;
    const btn = sheet.querySelector('[data-action="save-lesson"]');
    if (btn) btn.disabled = !ui.lessonDraft.subject.trim();
  }
});
sheet.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.field === 'title') { e.preventDefault(); actions['save-task'](); }
});

// настройки
view.addEventListener('change', (e) => {
  const key = e.target.dataset.setting;
  if (key) {
    let v = e.target.value.trim();
    if (key === 'lksUuid') { v = extractUuid(v); if (!v && e.target.value.trim()) toast('В ссылке не нашёлся код группы'); }
    if (key === 'weeks') v = Math.max(1, Math.min(30, Number(v) || 18));
    if (key === 'group') v = v.toUpperCase();
    state.settings[key] = v;
    save();
    render();
    if (key === 'group' || key === 'lksUuid') refreshSchedule({ silent: true, force: true });
  }
  if (e.target.dataset.actionChange === 'import' && e.target.files[0]) importData(e.target.files[0]);
});

// свайп влево/вправо по дню
(() => {
  let x0 = null, y0 = 0;
  view.addEventListener('touchstart', (e) => {
    if (ui.tab !== 'day') return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      ui.date = addDays(ui.date, dx < 0 ? 1 : -1);
      render();
    }
  }, { passive: true });
})();

// смена дня и «сейчас идёт»
function tick() {
  const t = todayISO();
  if (t !== ui.lastToday) {
    if (ui.date === ui.lastToday) ui.date = t;
    ui.lastToday = t;
  }
  if (!sheetRender && ui.tab === 'day') render();
}
setInterval(tick, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

/* ---------------- старт ---------------- */

render();
refreshSchedule({ silent: true });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
