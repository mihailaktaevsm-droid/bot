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
    settings: { group: DEFAULT_GROUP, semesterStart: guessSemesterStart(), weeks: 18, lksUuid: '', hidden: ['ФКиС', 'УТП МТ13'], hiddenV: 2 },
    schedule: { lessons: [], updatedAt: null, fetchedAt: null, source: null, title: '' },
    kmDone: {},
  };
}

// новые предметы, скрытые по умолчанию, добавляем и тем, у кого настройки уже сохранены
function migrateSettings(st) {
  if ((st.hiddenV || 1) < 2) {
    st.hidden = [...new Set([...(st.hidden || []), 'УТП МТ13'])];
    st.hiddenV = 2;
  }
  return st;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return {
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
      settings: migrateSettings({ ...d.settings, ...(s.settings || {}), hiddenV: (s.settings || {}).hiddenV || 1 }),
      schedule: { ...d.schedule, ...(s.schedule || {}) },
      kmDone: s.kmDone && typeof s.kmDone === 'object' ? s.kmDone : {},
      savedAt: s.savedAt || 0,
    };
  } catch (e) {
    return defaultState();
  }
}

let state = load();
function saveLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Не удалось сохранить: память переполнена'); }
}
// изменение данных пользователя: помечаем время и отправляем в облако Telegram (если открыто там)
function save() {
  state.savedAt = Date.now();
  saveLocal();
  cloudSave();
  serverSave();
}

const ui = {
  tab: 'day',
  date: todayISO(),
  lastToday: todayISO(),
  hwMode: 'due',
  showDone: false,
  showPastKm: false,
  openSubjects: new Set(),
  weekStart: null,
  draft: null,
  lessonDraft: null,
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- расписание ---------------- */

// семестр из учебного плана, в который попадает дата (вместе с сессией и каникулами)
function planSemester(s) {
  const sems = typeof STUDY_PLAN !== 'undefined' ? STUDY_PLAN.semesters : [];
  let cur = null;
  for (const sem of sems) if (s >= mondayOf(sem.start)) cur = sem;
  return cur && s <= cur.vacation[1] ? cur : null;
}

function weekInfo(s) {
  const sem = planSemester(s);
  if (sem) {
    const n = Math.floor(diffDays(mondayOf(sem.start), s) / 7) + 1;
    return {
      n, sem,
      numerator: n % 2 === 1,
      inSemester: s < sem.session[0],
      session: s >= sem.session[0] && s <= sem.session[1],
      vacation: s >= sem.vacation[0],
    };
  }
  const n = Math.floor(diffDays(mondayOf(state.settings.semesterStart || guessSemesterStart()), s) / 7) + 1;
  return { n, sem: null, numerator: n % 2 === 1, inSemester: n >= 1 && n <= (Number(state.settings.weeks) || 18) };
}

function fmtRange(a, b) {
  const da = parse(a), db = parse(b);
  return da.getMonth() === db.getMonth()
    ? `${da.getDate()}–${db.getDate()} ${MONTHS_SHORT[db.getMonth()]}`
    : `${da.getDate()} ${MONTHS_SHORT[da.getMonth()]} – ${db.getDate()} ${MONTHS_SHORT[db.getMonth()]}`;
}

/* --- контрольные мероприятия из учебного плана --- */

const KM_KINDS = {
  'ДЗ': { label: 'Сдача ДЗ', color: '#ff9500' },
  'РК': { label: 'Рубежный контроль', color: '#ff3b30' },
  'КР': { label: 'Контрольная работа', color: '#ff3b30' },
  'М': { label: 'Закрытие модуля', color: '#a35cff' },
  'Р': { label: 'Реферат', color: '#2f6bff' },
};
const EXAM_LABELS = { 'экз': 'Экзамен', 'р.экз': 'Экзамен (можно по рейтингу)', 'д.зач': 'Дифференцированный зачёт', 'зач': 'Зачёт', 'упм': 'Практика' };

function planSubjects(sem) {
  return sem ? sem.subjects.filter((x) => !isHidden(x.name) && !(x.short && isHidden(x.short))) : [];
}

function planSubject(name, sem) {
  return planSubjects(sem || weekInfo(todayISO()).sem).find((x) => x.name === name) || null;
}

function weekDates(sem, week) {
  const mon = addDays(mondayOf(sem.start), 7 * (week - 1));
  return [mon, addDays(mon, 6)];
}

function kmForWeek(sem, week) {
  if (!sem) return [];
  const out = [];
  for (const subj of planSubjects(sem)) {
    for (const [w, kind] of subj.events) {
      if (w === week) out.push({ id: `${sem.n}|${subj.name}|${w}|${kind}`, subject: subj.name, kind, week: w });
    }
  }
  const order = ['РК', 'КР', 'ДЗ', 'Р', 'М'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.subject.localeCompare(b.subject, 'ru'));
}

// срок контрольного: первая пара по предмету на этой неделе, иначе пятница
function kmDue(sem, e) {
  const [mon] = weekDates(sem, e.week);
  for (let i = 0; i < 6; i++) {
    const d = addDays(mon, i);
    if (lessonsFor(d).some((l) => l.subject === e.subject)) return d;
  }
  return addDays(mon, 4);
}

// невыполненные контрольные текущей недели и следующих — со сроками
function upcomingKM(days) {
  const today = todayISO();
  const w = weekInfo(today);
  if (!w.sem || !w.inSemester) return [];
  const limit = addDays(today, days);
  const out = [];
  for (let k = w.n; k <= w.sem.weeks; k++) {
    if (weekDates(w.sem, k)[0] > limit) break;
    for (const e of kmForWeek(w.sem, k)) {
      if (state.kmDone[e.id]) continue;
      const date = kmDue(w.sem, e);
      if (date <= limit) out.push({ ...e, date });
    }
  }
  return out;
}

function kmHTML(e, opts = {}) {
  const k = KM_KINDS[e.kind] || { label: e.kind, color: 'var(--accent)' };
  const done = !!state.kmDone[e.id];
  const late = e.date && !done && e.date < todayISO();
  return `
    <div class="task km ${done ? 'done' : ''}">
      <button class="check" data-action="toggle-km" data-id="${esc(e.id)}" aria-label="Готово">${CHECK_SVG}</button>
      <div class="body">
        <div class="title"><span class="km-tag" style="--c:${k.color}">${esc(e.kind)}</span>${opts.compact ? `${k.label} <span class="km-plan">по плану</span>` : esc(e.subject)}</div>
        <div class="sub">${opts.compact ? '' : `<span>${k.label}</span>`}${e.date && !opts.compact && !opts.noDate ? `<span>·</span><span class="${late ? 'late' : ''}">к ${esc(fmtRel(e.date))}</span>` : ''}</div>
      </div>
    </div>`;
}

function weekMatches(week, numerator) {
  return week === 'all' || (week === 'ch' && numerator) || (week === 'zn' && !numerator);
}

// скрытые предметы (по началу названия: «ФКиС» скрывает «ФКиС 09:25 Измайлово»)
function isHidden(subject) {
  const name = String(subject || '').toLowerCase();
  return (state.settings.hidden || []).some((h) => h && name.startsWith(h.toLowerCase()));
}
const visibleLessons = () => state.schedule.lessons.filter((l) => !isHidden(l.subject));

function lessonsFor(s) {
  const w = weekInfo(s);
  if (!w.inSemester) return [];
  const day = dowIdx(s) + 1;
  return visibleLessons()
    .filter((l) => l.day === day && weekMatches(l.week, w.numerator))
    .sort((a, b) => toMin(a.start) - toMin(b.start));
}

function lessonsForWeekday(day, numerator) {
  return visibleLessons()
    .filter((l) => l.day === day && weekMatches(l.week, numerator))
    .sort((a, b) => toMin(a.start) - toMin(b.start));
}

function allSubjects() {
  const set = new Set();
  visibleLessons().forEach((l) => l.subject && set.add(l.subject));
  planSubjects(weekInfo(todayISO()).sem).forEach((x) => x.exam !== 'упм' && set.add(x.name));
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
  saveLocal(); // расписание приходит из ЛКС само, в облако его не кладём
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

// задание «как в дневнике»: предмет сверху, текст задания ниже
function hwRowHTML(t, opts = {}) {
  const late = !t.done && t.date < todayISO();
  const meta = [];
  if (opts.showDate) meta.push(`<span class="${late ? 'late' : ''}">${esc(fmtRel(t.date))}</span>`);
  if (t.time) meta.push(`<span>${esc(t.time)}</span>`);
  return `
    <div class="task diary ${t.done ? 'done' : ''}">
      <button class="check" data-action="toggle" data-id="${t.id}" aria-label="Выполнено">${CHECK_SVG}</button>
      <div class="body" data-action="edit-task" data-id="${t.id}">
        ${opts.showSubject && t.subject ? `<div class="subj-top" style="--c:${subjectColor(t.subject)}">${esc(t.subject)}${t.important ? ' <span class="flag">!</span>' : ''}</div>` : ''}
        <div class="title">${!opts.showSubject && t.important ? '<span class="flag">!</span> ' : ''}${esc(t.title)}</div>
        ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
        ${meta.length ? `<div class="sub">${meta.join('<span>·</span>')}</div>` : ''}
      </div>
    </div>`;
}

// карточка пары: шапка (номер, время, аудитория), предмет, преподаватель,
// а под ними — что сдать к этой паре и контрольные по плану
function lessonCardHTML(l, date, opts = {}) {
  const type = LESSON_TYPES[l.type] || LESSON_TYPES.other;
  const num = l.slot || (SLOTS.findIndex((x) => x.start === l.start) + 1) || '';
  const hw = opts.hw || [];
  const kms = opts.kms || [];
  let progress = '';
  if (opts.status === 'now') {
    const pct = Math.min(100, Math.max(0, Math.round(((nowMinutes() - toMin(l.start)) / (toMin(l.end) - toMin(l.start))) * 100)));
    progress = `<div class="lprogress"><i style="width:${pct}%"></i></div>`;
  }
  const next = nextLessonDate(l.subject, date);
  return `
    <div class="lcard ${opts.status || ''}" style="--c:${subjectColor(l.subject)}">
      ${progress}
      <button class="lcard-main" data-action="open-lesson" data-id="${l.id}" data-date="${date}">
        <div class="lcard-head">
          <span class="lnum">${num}</span>
          <span class="ltime">${l.start}–${l.end}</span>
          <span class="lroom">${type.tag ? `<span class="tag">${type.tag}</span>` : ''}${esc(l.room || '')}</span>
        </div>
        ${opts.status === 'now' ? `<div class="lnow">Идёт сейчас · ещё ${fmtDuration(toMin(l.end) - nowMinutes())}</div>` : ''}
        <div class="lname">${esc(l.subject)}</div>
        ${l.teacher ? `<div class="lteacher">${esc(l.teacher)}</div>` : ''}
      </button>
      ${hw.length || kms.length ? `<div class="lhw">
        ${kms.map((e) => kmHTML(e, { compact: true })).join('')}
        ${hw.map((t) => hwRowHTML(t)).join('')}
      </div>` : ''}
      <button class="ladd" data-action="add-hw" data-subject="${esc(l.subject)}" ${next ? `data-date="${next}"` : ''}>＋ Записать ДЗ${next ? ` к ${esc(fmtRel(next))}` : ''}</button>
    </div>`;
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
    const kmDay = w.inSemester && mondayOf(d) === mondayOf(s) ? kmForWeek(w.sem, w.n).filter((e) => !state.kmDone[e.id] && kmDue(w.sem, e) === d).length : 0;
    const dots = (kmDay ? '<i class="km"></i>' : '') + active.slice(0, kmDay ? 2 : 3).map((t) => `<i class="${t.subject ? 'hw' : ''}"></i>`).join('');
    strip += `
      <button class="${d === today ? 'today' : ''} ${d === s ? 'selected' : ''}" data-action="pick-date" data-date="${d}">
        <span class="dow">${DOW_SHORT[i]}</span>
        <span class="num">${parse(d).getDate()}</span>
        <span class="dots">${dots}</span>
      </button>`;
  }
  const monthLabel = MONTHS_NOM[parse(s).getMonth()];

  // контрольные по плану на эту неделю; те, что приходятся на этот день, попадут в карточки пар
  const weekKms = w.inSemester ? kmForWeek(w.sem, w.n).map((e) => ({ ...e, date: kmDue(w.sem, e) })) : [];
  const dayKms = weekKms.filter((e) => e.date === s);

  // пары
  const lessons = lessonsFor(s);
  let lessonsHTML = '';
  if (!state.schedule.lessons.length) {
    lessonsHTML = emptyHTML('📚', 'Расписание ещё не загружено', `<button class="btn secondary" data-action="refresh-schedule">Загрузить расписание</button><button class="btn secondary" data-tab="settings" style="margin-top:8px">Настроить вручную</button>`);
  } else if (!lessons.length) {
    lessonsHTML = emptyHTML(dow === 6 ? '😴' : '🎉', w.inSemester ? 'Пар нет — свободный день' : 'Вне учебного семестра');
  } else {
    const nm = nowMinutes();
    const shown = new Set(); // домашку и контрольные показываем у первой пары предмета за день
    let html = '';
    lessons.forEach((l, i) => {
      if (i > 0) {
        const gap = toMin(l.start) - toMin(lessons[i - 1].end);
        if (gap >= 40) html += `<div class="lbreak">☕ Окно · ${fmtDuration(gap)}</div>`;
      }
      let status = '';
      if (isToday) {
        if (nm >= toMin(l.end)) status = 'past';
        else if (nm >= toMin(l.start)) status = 'now';
      }
      const first = !shown.has(l.subject);
      shown.add(l.subject);
      const hw = first ? state.tasks.filter((t) => t.subject === l.subject && t.date === s).sort(taskSort) : [];
      const kmsHere = first ? dayKms.filter((e) => e.subject === l.subject) : [];
      html += lessonCardHTML(l, s, { status, hw, kms: kmsHere });
    });
    lessonsHTML = html;
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

  // задачи (домашка к сегодняшним парам уже в карточках — здесь только остальное)
  const inCards = new Set(lessons.map((l) => l.subject));
  const list = tasksOn(s).filter((t) => !t.subject || !inCards.has(t.subject));
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

  // домашка обычно задана к следующей паре — показываем её заранее, а не только в день сдачи
  if (isToday) {
    const weekAhead = addDays(today, 7);
    const upcoming = state.tasks
      .filter((t) => t.subject && !t.done && t.date > today && t.date <= weekAhead)
      .sort((a, b) => a.date.localeCompare(b.date) || taskSort(a, b));
    if (upcoming.length) {
      tasksHTML += `<div class="section-title">Домашка на неделю <small>${upcoming.length}</small></div>
        <div class="card">${upcoming.map((t) => hwRowHTML(t, { showSubject: true, showDate: true })).join('')}</div>`;
    }
  }

  const weekLabel = w.inSemester
    ? `<span class="pill">${w.n} неделя</span><span class="pill gray">${w.numerator ? 'Числитель' : 'Знаменатель'}</span>`
    : w.session ? '<span class="pill danger">Сессия</span>' : w.vacation ? '<span class="pill gray">Каникулы</span>' : '';

  const otherKms = weekKms.filter((e) => e.date !== s || !lessons.some((l) => l.subject === e.subject));
  const kmLeft = weekKms.filter((e) => !state.kmDone[e.id]).length;
  const kmBlock = otherKms.length ? `
      <div class="section-title">Контрольные на неделе <small>${kmLeft ? `осталось ${kmLeft}` : 'всё сдано'}</small></div>
      <div class="card">${otherKms.map(kmHTML).join('')}</div>` : '';

  // сводка дня одной строкой
  const hwToday = state.tasks.filter((t) => t.subject && !t.done && t.date === s).length;
  const kmToday = dayKms.filter((e) => !state.kmDone[e.id]).length;
  const summary = [
    lessons.length ? `<span><b>${lessons.length}</b> ${plural(lessons.length, 'пара', 'пары', 'пар')}</span>` : '',
    hwToday ? `<span><b>${hwToday}</b> ДЗ</span>` : '',
    kmToday ? `<span class="warn"><b>${kmToday}</b> ${plural(kmToday, 'контрольная', 'контрольные', 'контрольных')}</span>` : '',
  ].filter(Boolean).join('');

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
      ${summary ? `<div class="day-summary">${summary}</div>` : ''}
      <div class="section-title">Пары <small>${lessonsSub}</small></div>
      ${lessonsHTML}
      ${tasksHTML}
      ${kmBlock}
    </div>`;
}

/* ---------------- вкладка «Домашка» ---------------- */

function renderHW() {
  const hw = state.tasks.filter((t) => t.subject);
  const active = hw.filter((t) => !t.done);
  const km = upcomingKM(14);
  const today = todayISO();
  const tomorrow = addDays(today, 1);
  const sunday = addDays(mondayOf(today), 6);

  let body = '';
  if (ui.hwMode === 'due') {
    // свои задания + контрольные из учебного плана на 2 недели вперёд
    const all = [
      ...active.map((t) => ({ date: t.date, t })),
      ...km.map((e) => ({ date: e.date, e })),
    ];
    const byOrder = (a, b) => a.date.localeCompare(b.date) || (a.t && b.t ? taskSort(a.t, b.t) : a.e ? -1 : b.e ? 1 : 0);
    const item = (x, showDate) => (x.t ? hwRowHTML(x.t, { showSubject: true, showDate }) : kmHTML(x.e, { noDate: !showDate }));
    const late = all.filter((x) => x.date < today).sort(byOrder);
    if (late.length) {
      body += `<div class="section-title danger">Просрочено <small>${late.length}</small></div>
        <div class="card">${late.map((x) => item(x, true)).join('')}</div>`;
    }
    const dates = [...new Set(all.filter((x) => x.date >= today).map((x) => x.date))].sort();
    for (const d of dates) {
      const items = all.filter((x) => x.date === d).sort(byOrder);
      const rel = d === today ? 'Сегодня' : d === tomorrow ? 'Завтра' : DOW_FULL[dowIdx(d)];
      body += `<div class="section-title ${d === today ? 'accent' : ''}"><span class="cap">${rel}</span> <small>${fmtDay(d)}${d > tomorrow ? '' : ', ' + DOW_FULL[dowIdx(d)]}</small></div>
        <div class="card">${items.map((x) => item(x, false)).join('')}</div>`;
    }
    if (!all.length) body += emptyHTML('🎓', 'Вся домашка сделана!<br>Добавь новую через <b>+</b> или нажав на пару.');
    if (km.length) body += '<div class="list-foot">ДЗ, РК и модули из учебного плана показаны на 2 недели вперёд. Весь семестр — во вкладке «Контрольные».</div>';
    const doneList = hw.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    if (doneList.length) {
      body += `<div class="section-title"><span>Выполнено <small>${doneList.length}</small></span>
        <button class="link-btn" data-action="toggle-done">${ui.showDone ? 'Скрыть' : 'Показать'}</button></div>`;
      if (ui.showDone) body += `<div class="card">${doneList.slice(0, 50).map((t) => hwRowHTML(t, { showSubject: true, showDate: true })).join('')}</div>`;
    }
  } else if (ui.hwMode === 'km') {
    body = renderKM();
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
          inner = act.map((t) => hwRowHTML(t, { showDate: true })).join('');
          const doneItems = items.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 3);
          inner += doneItems.map((t) => hwRowHTML(t, { showDate: true })).join('');
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
        <div class="subtitle">${active.length + km.length ? `${active.length + km.length} ${plural(active.length + km.length, 'задание', 'задания', 'заданий')} не сделано` : 'всё сделано'}</div>
      </div></div>
      <div class="segmented">
        <button class="${ui.hwMode === 'due' ? 'active' : ''}" data-action="hw-mode" data-mode="due">По сроку</button>
        <button class="${ui.hwMode === 'subject' ? 'active' : ''}" data-action="hw-mode" data-mode="subject">Предметы</button>
        <button class="${ui.hwMode === 'km' ? 'active' : ''}" data-action="hw-mode" data-mode="km">Контрольные</button>
      </div>
      ${body}
    </div>`;
}

function renderKM() {
  const today = todayISO();
  const w = weekInfo(today);
  const sem = w.sem;
  if (!sem) return emptyHTML('📋', 'Учебный план на эти даты не загружен.');
  const cur = w.inSemester ? w.n : w.session || w.vacation ? sem.weeks + 1 : 1;
  let html = '';

  const from = ui.showPastKm ? 1 : cur;
  for (let k = from; k <= sem.weeks; k++) {
    const items = kmForWeek(sem, k);
    if (!items.length) continue;
    const [a, b] = weekDates(sem, k);
    const left = items.filter((e) => !state.kmDone[e.id]).length;
    html += `<div class="section-title ${k === cur ? 'accent' : ''}">${k} неделя${k === cur ? ' · сейчас' : ''} <small>${fmtRange(a, b)}${left ? '' : ' ✓'}</small></div>
      <div class="card">${items.map(kmHTML).join('')}</div>`;
  }
  if (cur > 1) html += `<button class="btn secondary" data-action="toggle-past-km">${ui.showPastKm ? 'Скрыть прошедшие недели' : 'Показать прошедшие недели'}</button>`;

  const subj = planSubjects(sem).filter((x) => x.exam !== 'упм');
  const exams = subj.filter((x) => /экз/.test(x.exam));
  const credits = subj.filter((x) => /зач/.test(x.exam));
  html += `<div class="section-title">Сессия <small>${fmtRange(sem.session[0], sem.session[1])}</small></div>
    <div class="card">
      ${exams.map((x) => `<div class="row"><span class="label">${esc(x.name)}</span><span class="value">${x.exam === 'р.экз' ? 'экз · рейтинг' : 'экзамен'}</span></div>`).join('')}
      ${credits.map((x) => `<div class="row"><span class="label">${esc(x.name)}</span><span class="value">${x.exam === 'д.зач' ? 'дифф. зачёт' : 'зачёт'}</span></div>`).join('')}
    </div>
    <div class="list-foot">ДЗ — сдача домашнего задания, РК — рубежный контроль, КР — контрольная, М — закрытие модуля. «Экзамен по рейтингу» можно получить автоматом за баллы в семестре.</div>`;
  return html;
}

/* ---------------- вкладка «Неделя»: дневник ---------------- */

function renderWeek() {
  const today = todayISO();
  if (!ui.weekStart) ui.weekStart = mondayOf(today);
  const mon = ui.weekStart;
  const w = weekInfo(mon);
  const isThisWeek = mon === mondayOf(today);
  const kms = w.inSemester ? kmForWeek(w.sem, w.n).map((e) => ({ ...e, date: kmDue(w.sem, e) })) : [];

  let body = '';
  if (!state.schedule.lessons.length) {
    body = emptyHTML('🗓️', 'Расписание пустое', '<button class="btn" data-action="refresh-schedule">Загрузить из ЛКС</button><button class="btn secondary" data-action="add-lesson" style="margin-top:8px">Добавить пару вручную</button>');
  } else {
    for (let i = 0; i < 6; i++) {
      const d = addDays(mon, i);
      const ls = lessonsFor(d);
      const isToday = d === today;
      const shown = new Set();
      const rows = ls.map((l) => {
        const first = !shown.has(l.subject);
        shown.add(l.subject);
        const hw = first ? state.tasks.filter((t) => t.subject === l.subject && t.date === d).sort(taskSort) : [];
        const kmHere = first ? kms.filter((e) => e.subject === l.subject && e.date === d) : [];
        const type = LESSON_TYPES[l.type] || LESSON_TYPES.other;
        const num = l.slot || (SLOTS.findIndex((x) => x.start === l.start) + 1) || '';
        return `
          <div class="wrow" style="--c:${subjectColor(l.subject)}">
            <button class="wmain" data-action="open-lesson" data-id="${l.id}" data-date="${d}">
              <span class="lnum small">${num}</span>
              <span class="wtime">${l.start}</span>
              <span class="wname">${esc(l.subject)}</span>
              <span class="wroom">${type.tag ? `<span class="tag">${type.tag}</span>` : ''}${esc(l.room || '')}</span>
            </button>
            ${kmHere.length || hw.length ? `<div class="whw">${kmHere.map((e) => kmHTML(e, { compact: true })).join('')}${hw.map((t) => hwRowHTML(t)).join('')}</div>` : ''}
          </div>`;
      }).join('');
      const extra = state.tasks.filter((t) => t.date === d && (!t.subject || !shown.has(t.subject))).sort(taskSort);
      body += `
        <div class="wday ${isToday ? 'today' : ''}">
          <div class="wday-h"><span><span class="cap">${DOW_FULL[i]}</span>, ${fmtDay(d)}</span>${isToday ? '<span class="pill">сегодня</span>' : ls.length ? `<small>${ls[0].start}–${ls[ls.length - 1].end}</small>` : ''}</div>
          ${rows || '<div class="wempty">Пар нет</div>'}
          ${extra.length ? `<div class="wextra">${extra.map((t) => hwRowHTML(t, { showSubject: true })).join('')}</div>` : ''}
        </div>`;
    }
    body += '<button class="btn secondary" data-action="add-lesson">＋ Добавить пару вручную</button>';
  }

  const label = w.inSemester ? `${w.n} неделя · ${w.numerator ? 'числитель' : 'знаменатель'}` : w.session ? 'сессия' : w.vacation ? 'каникулы' : 'вне семестра';
  return `
    <div class="fade-in">
      <div class="header">
        <div>
          <h1>Неделя</h1>
          <div class="subtitle">${fmtRange(mon, addDays(mon, 6))} · ${label}</div>
        </div>
        ${isThisWeek ? '<button class="link-btn" data-action="refresh-schedule">Обновить</button>' : '<button class="link-btn" data-action="week-today">Текущая</button>'}
      </div>
      <div class="week-nav">
        <button data-action="shift-diary-week" data-n="-1">‹ Предыдущая</button>
        <button data-action="shift-diary-week" data-n="1">Следующая ›</button>
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
        <div class="row"><span class="label">Сейчас</span><span class="value">${w.sem ? `${w.sem.n} семестр, ` : ''}${w.inSemester ? `${w.n} неделя, ${w.numerator ? 'числитель' : 'знаменатель'}` : w.session ? 'сессия' : w.vacation ? 'каникулы' : 'вне семестра'}</span></div>
        ${w.sem ? `<div class="row"><span class="label">Семестр</span><span class="value">${fmtRange(w.sem.start, addDays(w.sem.session[0], -1))}</span></div>
        <div class="row"><span class="label">Сессия</span><span class="value">${fmtRange(w.sem.session[0], w.sem.session[1])}</span></div>
        <div class="row"><span class="label">Каникулы</span><span class="value">${fmtRange(w.sem.vacation[0], w.sem.vacation[1])}</span></div>` : `
        <label class="row"><span class="label">Начало семестра</span><input type="date" data-setting="semesterStart" value="${esc(s.semesterStart)}"></label>`}
      </div>
      <div class="list-foot">${typeof STUDY_PLAN !== 'undefined' ? esc(STUDY_PLAN.title) + '. ' : ''}Нечётные недели — числитель, чётные — знаменатель.</div>

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
      ${(s.hidden || []).length ? `
      <div class="list-label">Скрытые предметы</div>
      <div class="list">${s.hidden.map((h, i) => `<div class="row"><span class="label">${esc(h)}</span><button class="link-btn" data-action="unhide-subject" data-i="${i}">Вернуть</button></div>`).join('')}</div>
      <div class="list-foot">Эти занятия не показываются в расписании, даже после обновления из ЛКС.</div>` : ''}
      <div class="list-foot">Расписание подтягивается само из ЛКС раз в день. Если не вышло: открой своё расписание на lks.bmstu.ru, скопируй ссылку из адресной строки в поле «Ссылка ЛКС», нажми «Открыть расписание в ЛКС», скопируй весь текст страницы и вставь через «Вставить расписание».</div>

      ${syncApi() ? syncSettingsHTML() : ''}

      <div class="list-label">Данные</div>
      <div class="list">
        <button class="row accent" data-action="export">Сохранить резервную копию</button>
        <label class="row accent">Восстановить из копии<input type="file" accept="application/json,.json" data-action-change="import"></label>
        <button class="row danger" data-action="clear-done" ${doneCount ? '' : 'disabled'}>Удалить выполненные (${doneCount})</button>
      </div>
      <div class="list-foot">${syncKey && syncApi() ? 'Задачи синхронизируются через сервер. Резервная копия — на всякий случай.' : tg ? 'В Telegram задачи хранятся в облаке Telegram. Чтобы они совпадали с айфоном и компьютером, включи синхронизацию выше.' : 'Пока синхронизация не включена, задачи хранятся только на этом устройстве. Время от времени сохраняй резервную копию.'}</div>

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

function syncSettingsHTML() {
  const r = state.settings.remind || {};
  const status = !syncKey ? 'не подключена' : syncStatus === 'error' ? 'нет связи с сервером' : 'включена ✓';
  const opt = (v, cur, label) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
  return `
      <div class="list-label">Синхронизация</div>
      <div class="list">
        <div class="row"><span class="label">Статус</span><span class="value">${status}</span></div>
        ${syncKey ? '<button class="row accent" data-action="share-sync">Скопировать ключ для другого устройства</button>' : ''}
        <label class="row"><span class="label">${syncKey ? 'Подключить другой ключ' : 'Вставить ключ'}</span><input type="text" data-sync-key placeholder="ключ" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      </div>
      <div class="list-foot">${tg
        ? 'Задачи хранятся на сервере и видны везде, где введён этот ключ. Скопируй ключ и вставь его в приложении на айфоне или на компьютере («Ещё» → «Вставить ключ»). Со второго аккаунта Telegram тоже можно вставить этот ключ — тогда задачи будут общими.'
        : 'Ключ берётся в Telegram-боте: открой ежедневник там → «Ещё» → «Скопировать ключ», и вставь сюда. После этого задачи здесь и в Telegram будут одинаковыми.'}</div>

      <div class="list-label">Напоминания в Telegram</div>
      <div class="list">
        <label class="row"><span class="label">О парах</span><select data-remind="lessons">${opt('first', r.lessons || 'first', 'перед первой')}${opt('all', r.lessons, 'перед каждой')}${opt('off', r.lessons, 'выключено')}</select></label>
        <label class="row"><span class="label">За сколько минут</span><select data-remind="leadMin">${opt(10, r.leadMin || 15, '10')}${opt(15, r.leadMin || 15, '15')}${opt(30, r.leadMin || 15, '30')}</select></label>
        <label class="row"><span class="label">О делах со временем</span><select data-remind="tasks">${opt('on', r.tasks === false ? 'off' : 'on', 'в назначенное время')}${opt('off', r.tasks === false ? 'off' : 'on', 'выключено')}</select></label>
      </div>
      <div class="list-foot">Бот напишет перед парой (с тем, что сдавать) и в момент, на который поставлено дело. Работает, когда синхронизация включена.</div>`;
}

/* ---------------- главный рендер ---------------- */

const view = document.getElementById('view');
const fab = document.getElementById('fab');

function render() {
  const scroll = window.scrollY;
  const renderers = { day: renderDay, hw: renderHW, week: renderWeek, settings: renderSettings };
  view.innerHTML = renderers[ui.tab]();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  fab.classList.toggle('hidden', ui.tab === 'settings');
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
  if (tg) tg.BackButton.show();
}
function rerenderSheet() { if (sheetRender) sheet.innerHTML = '<div class="grabber"></div>' + sheetRender(); }
function closeSheet() {
  sheet.classList.remove('open');
  backdrop.classList.remove('open');
  document.activeElement && document.activeElement.blur();
  sheetRender = null;
  ui.draft = null;
  ui.lessonDraft = null;
  if (tg) tg.BackButton.hide();
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
    + `<label class="chip ${custom ? 'active' : ''}"><span>📅 ${custom ? esc(fmtRel(d.date)) : 'Другая дата'}</span><input type="date" data-field="date" value="${d.date}"></label>`;

  // время
  const dayLessons = lessonsFor(d.date);
  const beforeTime = dayLessons.length ? fromMin(toMin(dayLessons[0].start) - 15) : null;
  const afterTime = dayLessons.length ? dayLessons[dayLessons.length - 1].end : null;
  const timeChips = [
    `<button class="chip ${!d.time ? 'active' : ''}" data-action="draft-time" data-time="">Без времени</button>`,
    beforeTime ? `<button class="chip ${d.time === beforeTime ? 'active' : ''}" data-action="draft-time" data-time="${beforeTime}">Перед парами · ${beforeTime}</button>` : '',
    afterTime ? `<button class="chip ${d.time === afterTime ? 'active' : ''}" data-action="draft-time" data-time="${afterTime}">После пар · ${afterTime}</button>` : '',
    `<label class="chip ${d.time && d.time !== beforeTime && d.time !== afterTime ? 'active' : ''}"><span>🕒 ${d.time && d.time !== beforeTime && d.time !== afterTime ? d.time : 'Выбрать'}</span><input type="time" data-field="time" value="${d.time}"></label>`,
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
      ${(() => {
        const w = weekInfo(today);
        const ps = planSubject(l.subject, w.sem);
        if (!ps) return '';
        const curW = w.inSemester ? w.n : 99;
        const next = ps.events.filter(([k]) => k >= curW);
        return `
      <div class="field-label">По учебному плану</div>
      <div class="info-grid">
        <div class="row"><span class="label">Аттестация</span><span class="value">${EXAM_LABELS[ps.exam] || esc(ps.exam)}</span></div>
        ${next.length ? `<div class="row" style="align-items:flex-start"><span class="label">Контрольные</span><span class="value">${next.map(([k, kind]) => `${k} нед — ${{ 'М': 'модуль', 'КР': 'контрольная', 'Р': 'реферат' }[kind] || kind}`).join('<br>')}</span></div>` : ''}
      </div>`;
      })()}
      <div class="field-label">Домашка по предмету</div>
      ${hw.length ? `<div class="card">${hw.map((t) => taskHTML(t, { showDate: true })).join('')}</div>` : '<div class="card"><div class="empty" style="padding:16px">Ничего не задано</div></div>'}
      <button class="btn" data-action="add-hw" data-subject="${esc(l.subject)}" ${target ? `data-date="${target}"` : ''}>＋ Добавить ДЗ${target ? ` к ${esc(fmtRel(target))}` : ''}</button>
      <button class="btn danger" data-action="hide-subject" data-subject="${esc(l.subject)}">Скрыть предмет из расписания</button>
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
        settings: migrateSettings({ ...d.settings, ...(data.settings || {}), hiddenV: (data.settings || {}).hiddenV || 1 }),
        schedule: { ...d.schedule, ...(data.schedule || {}) },
        kmDone: data.kmDone || {},
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
  'hide-subject': (el) => {
    const name = el.dataset.subject;
    const prev = [...(state.settings.hidden || [])];
    state.settings.hidden = [...prev, name];
    save(); closeSheet(); render();
    toast(`«${name}» скрыт`, () => { state.settings.hidden = prev; save(); render(); });
  },
  'unhide-subject': (el) => {
    state.settings.hidden = (state.settings.hidden || []).filter((_, i) => i !== Number(el.dataset.i));
    save(); render();
  },
  'delete-lesson': () => {
    if (!confirm('Удалить эту пару из расписания?')) return;
    state.schedule.lessons = state.schedule.lessons.filter((x) => x.id !== ui.lessonDraft.id);
    save(); closeSheet(); render();
  },

  'hw-mode': (el) => { ui.hwMode = el.dataset.mode; render(); },
  'toggle-done': () => { ui.showDone = !ui.showDone; render(); },
  'toggle-past-km': () => { ui.showPastKm = !ui.showPastKm; render(); },
  'toggle-km': (el) => {
    const id = el.dataset.id;
    if (state.kmDone[id]) delete state.kmDone[id]; else state.kmDone[id] = Date.now();
    save();
    const row = el.closest('.task');
    row && row.classList.toggle('done');
    if (state.kmDone[id] && navigator.vibrate) navigator.vibrate(10);
    setTimeout(render, 280);
  },
  'toggle-subject': (el) => {
    const s = el.dataset.subject;
    ui.openSubjects.has(s) ? ui.openSubjects.delete(s) : ui.openSubjects.add(s);
    render();
  },
  'shift-diary-week': (el) => { ui.weekStart = addDays(ui.weekStart || mondayOf(todayISO()), 7 * Number(el.dataset.n)); render(); window.scrollTo(0, 0); },
  'week-today': () => { ui.weekStart = mondayOf(todayISO()); render(); },

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
  'share-sync': shareSyncKey,
  'clear-done': () => {
    const n = state.tasks.filter((t) => t.done).length;
    if (!n || !confirm(`Удалить ${n} выполненных задач?`)) return;
    state.tasks = state.tasks.filter((t) => !t.done);
    save(); render();
  },
};

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

document.addEventListener('click', (e) => {
  // на компьютере клик по полю даты/времени сам календарь не открывает — открываем явно
  if (finePointer && e.target.matches && e.target.matches('input[type="date"], input[type="time"]') && e.target.showPicker) {
    try { e.target.showPicker(); } catch (err) { /* уже открыт или браузер не умеет */ }
  }
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
    // Пока открыт системный выбор даты/времени, шторку не перерисовываем: iPhone шлёт
    // событие на каждый поворот колёсика, и перерисовка закрывала/дёргала пикер.
    // Обновляем только подпись чипа, а полностью перерисуем, когда пикер закроется.
    if (f === 'date' || f === 'time') {
      if (f === 'date' && !e.target.value) ui.draft.date = todayISO();
      const chip = e.target.closest('.chip');
      const label = chip && chip.querySelector('span');
      if (chip) {
        chip.parentElement.querySelectorAll('.chip.active').forEach((c) => c !== chip && c.classList.remove('active'));
        chip.classList.toggle('active', !!e.target.value);
      }
      if (label) label.textContent = f === 'date' ? `📅 ${fmtRel(ui.draft.date)}` : `🕒 ${e.target.value || 'Выбрать'}`;
      pickerDirty = true;
    }
  }
  if (lf && ui.lessonDraft) {
    ui.lessonDraft[lf] = e.target.value;
    const btn = sheet.querySelector('[data-action="save-lesson"]');
    if (btn) btn.disabled = !ui.lessonDraft.subject.trim();
  }
});
let pickerDirty = false;
// Поле теряет фокус уже при нажатии на кнопку («Готово»), а сам клик приходит позже.
// Если перерисовать шторку сразу, кнопка исчезнет и клик потеряется — поэтому ждём,
// пока палец/кнопка мыши отпущены и клик обработан.
let pointerIsDown = false;
document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
document.addEventListener('pointerup', () => setTimeout(() => { pointerIsDown = false; }, 0), true);
document.addEventListener('pointercancel', () => { pointerIsDown = false; }, true);
function rerenderWhenIdle() {
  if (pointerIsDown) setTimeout(rerenderWhenIdle, 50);
  else rerenderSheet();
}
sheet.addEventListener('focusout', (e) => {
  const f = e.target.dataset && e.target.dataset.field;
  if ((f === 'date' || f === 'time') && pickerDirty) {
    pickerDirty = false;
    setTimeout(rerenderWhenIdle, 0); // после закрытия пикера — пересчитать чипы (например, «Перед парами»)
  }
});
// клавиатура: Esc закрывает окно, стрелки ← → листают дни
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetRender) { closeSheet(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (typing || sheetRender || ui.tab !== 'day' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    ui.date = addDays(ui.date, e.key === 'ArrowRight' ? 1 : -1);
    render();
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
  const rk = e.target.dataset.remind;
  if (rk) {
    const v = e.target.value;
    state.settings.remind = { ...(state.settings.remind || {}), [rk]: rk === 'leadMin' ? Number(v) : rk === 'tasks' ? v === 'on' : v };
    save();
    toast('Сохранено');
  }
  if ('syncKey' in e.target.dataset && e.target.value.trim()) linkKey(e.target.value);
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

/* ---------------- Telegram Mini App ---------------- */

// Внутри Telegram задачи синхронизируются через Telegram CloudStorage:
// одни и те же данные на телефоне и компьютере. Значение ключа — до 4096 символов,
// поэтому состояние режется на куски st_0, st_1, … и их число лежит в st_n.
let tg = null;
let cloudReady = false;
let cloudTimer = null;
const CLOUD_CHUNK = 4000;

function syncData() {
  return {
    savedAt: state.savedAt || 0,
    tasks: state.tasks,
    settings: state.settings,
    kmDone: state.kmDone,
    manual: state.schedule.lessons.filter((l) => l.manual),
  };
}
const cloudPayload = () => JSON.stringify(syncData());

// пришла более свежая версия с другого устройства — заменяем свои данные
function applyRemote(data, savedAt) {
  const d = defaultState();
  state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  state.settings = migrateSettings({ ...d.settings, ...(data.settings || {}), hiddenV: (data.settings || {}).hiddenV || 1 });
  state.kmDone = data.kmDone || {};
  state.schedule.lessons = [...state.schedule.lessons.filter((l) => !l.manual), ...(data.manual || [])];
  state.savedAt = savedAt;
  saveLocal();
  cloudSave();
  if (!sheetRender) render();
}

function cloudSave() {
  if (!tg || !cloudReady) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    const data = cloudPayload();
    const n = Math.max(1, Math.ceil(data.length / CLOUD_CHUNK));
    for (let i = 0; i < n; i++) tg.CloudStorage.setItem('st_' + i, data.slice(i * CLOUD_CHUNK, (i + 1) * CLOUD_CHUNK));
    tg.CloudStorage.setItem('st_n', String(n));
  }, 700);
}

function cloudLoad() {
  const cs = tg.CloudStorage;
  cs.getItem('st_n', (err, nStr) => {
    const n = Number(nStr) || 0;
    if (err || !n) { cloudReady = true; if (state.savedAt) cloudSave(); return; }
    const keys = Array.from({ length: n }, (_, i) => 'st_' + i);
    cs.getItems(keys, (err2, vals) => {
      cloudReady = true;
      if (err2) return;
      try {
        const data = JSON.parse(keys.map((k) => vals[k] || '').join(''));
        if ((data.savedAt || 0) > (state.savedAt || 0)) {
          applyRemote(data, data.savedAt);
        } else if ((state.savedAt || 0) > (data.savedAt || 0)) {
          cloudSave();
        }
      } catch (e) { /* повреждённые данные в облаке — оставляем локальные */ }
    });
  });
}

function applyTelegramTheme() {
  const dark = tg.colorScheme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    tg.setHeaderColor(dark ? '#000000' : '#f2f2f7');
    tg.setBackgroundColor(dark ? '#000000' : '#f2f2f7');
    if (tg.setBottomBarColor) tg.setBottomBarColor(dark ? '#000000' : '#f2f2f7');
  } catch (e) { /* старые версии Telegram */ }
}

function initTelegram() {
  const app = window.Telegram && window.Telegram.WebApp;
  if (!app || !app.initData) return; // скрипт загрузился, но мы не в Telegram
  tg = app;
  document.documentElement.classList.add('tg');
  tg.ready();
  tg.expand();
  if (tg.isVersionAtLeast && tg.isVersionAtLeast('7.7') && tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  applyTelegramTheme();
  tg.onEvent('themeChanged', applyTelegramTheme);
  tg.BackButton.onClick(closeSheet);
  if (tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) cloudLoad();
  tgLogin();
}

/* ---------------- синхронизация через свой сервер (Cloudflare) ---------------- */

// Один «ключ синхронизации» = одни данные. В Telegram ключ выдаёт сервер по подписи Telegram,
// на айфоне/компьютере его вставляют вручную или открывают ссылку вида …/bot/#sync=КЛЮЧ.
const SYNC_KEY_STORE = 'bmstu-planner-sync';
const syncApi = () => (typeof SYNC_API !== 'undefined' && SYNC_API) || '';
let syncKey = '';
try { syncKey = localStorage.getItem(SYNC_KEY_STORE) || ''; } catch (e) { /* приватный режим */ }
let syncStatus = 'off'; // off | ok | error
let syncTimer = null;

function setSyncKey(k) {
  syncKey = k || '';
  try { syncKey ? localStorage.setItem(SYNC_KEY_STORE, syncKey) : localStorage.removeItem(SYNC_KEY_STORE); } catch (e) { /* ничего */ }
}

async function api(path, opts = {}) {
  const r = await fetch(syncApi() + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(syncKey ? { Authorization: 'Bearer ' + syncKey } : {}), ...(opts.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function serverPull() {
  if (!syncApi() || !syncKey) return;
  try {
    const { status, body } = await api('/api/state');
    if (status !== 200) throw new Error(status);
    syncStatus = 'ok';
    if (body.data && body.savedAt > (state.savedAt || 0)) applyRemote(body.data, body.savedAt);
    else if ((state.savedAt || 0) > (body.savedAt || 0)) serverPush();
  } catch (e) { syncStatus = 'error'; }
  if (ui.tab === 'settings' && !sheetRender) render();
}

async function serverPush() {
  if (!syncApi() || !syncKey) return;
  try {
    const { status, body } = await api('/api/state', { method: 'PUT', body: JSON.stringify({ savedAt: state.savedAt || 0, data: syncData() }) });
    if (status === 409 && body.newer) applyRemote(body.newer.data, body.newer.savedAt);
    else if (status !== 200) throw new Error(status);
    syncStatus = 'ok';
  } catch (e) { syncStatus = 'error'; }
}

function serverSave() {
  if (!syncApi() || !syncKey) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(serverPush, 1200);
}

async function tgLogin(linkKey) {
  if (!syncApi() || !tg) return false;
  try {
    const { status, body } = await api('/api/tg-login', {
      method: 'POST',
      body: JSON.stringify({ initData: tg.initData, key: linkKey || syncKey || undefined, link: !!linkKey }),
    });
    if (status !== 200 || !body.key) throw new Error(status);
    setSyncKey(body.key);
    await serverPull();
    return true;
  } catch (e) { syncStatus = 'error'; return false; }
}

async function linkKey(raw) {
  const k = String(raw || '').trim().replace(/^.*#sync=/, '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(k)) { toast('Это не похоже на ключ синхронизации'); return; }
  if (tg) { if (!(await tgLogin(k))) { toast('Не удалось подключиться к серверу'); return; } }
  else { setSyncKey(k); state.savedAt = 0; await serverPull(); }
  toast(syncStatus === 'ok' ? 'Синхронизация подключена' : 'Сервер не ответил, попробую позже');
  render();
}

async function shareSyncKey() {
  if (!syncKey) return;
  const text = syncKey;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); toast('Ключ скопирован'); return; }
  } catch (e) { /* ниже — запасной вариант */ }
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  prompt('Скопируй ключ:', text);
}

// ссылка с ключом: …/bot/#sync=КЛЮЧ
(() => {
  const m = location.hash.match(/sync=([A-Za-z0-9_-]{20,64})/);
  if (m) {
    setSyncKey(m[1]);
    state.savedAt = Math.min(state.savedAt || 0, 1); // данные с сервера важнее пустого нового устройства
    history.replaceState(null, '', location.pathname + location.search);
  }
})();
serverPull();
document.addEventListener('visibilitychange', () => { if (!document.hidden) serverPull(); });

// SDK грузим только когда страницу открыл Telegram — в Safari он не нужен
if (/tgWebApp/.test(location.hash + location.search) || window.TelegramWebviewProxy || window.TelegramWebview) {
  const s = document.createElement('script');
  s.src = 'https://telegram.org/js/telegram-web-app.js';
  s.onload = initTelegram;
  document.head.appendChild(s);
}

/* ---------------- старт ---------------- */

render();
refreshSchedule({ silent: true });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
