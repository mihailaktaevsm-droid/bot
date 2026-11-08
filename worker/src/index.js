// Сервер ежедневника на Cloudflare Workers.
//  • /api/*  — синхронизация задач между айфоном, Telegram и компьютером (Workers KV)
//  • cron    — каждые 5 минут шлёт напоминания в Telegram: перед парой и в момент дела
//
// Данные в KV:
//   tg:<telegram user id>  → ключ синхронизации этого пользователя
//   st:<sha256(ключа)>     → {savedAt, data} — задачи, настройки, отметки контрольных
//   meta:<sha256(ключа)>   → {chats: [id, …]} — куда слать напоминания
//   sent:<…>               → отметка «напоминание уже отправлено» (живёт 2 дня)

const APP_URL = 'https://mihailaktaevsm-droid.github.io/bot/';
const MSK_OFFSET_MIN = 180;
const DOW = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const ACT = { lecture: 'лек', seminar: 'сем', lab: 'лаб' };
const KM = { 'ДЗ': 'сдача ДЗ', 'РК': 'рубежный контроль', 'КР': 'контрольная', 'М': 'закрытие модуля', 'Р': 'реферат' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
});

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}

function newKey() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Проверка подписи данных Telegram Mini App (core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
export async function verifyInitData(initData, botToken, maxAgeSec = 7 * 86400) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const calc = hex(await hmac(secret, check));
  if (calc !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

const validKey = (k) => typeof k === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(k);

function bearer(request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/);
  return m && validKey(m[1]) ? m[1] : null;
}

async function addChat(env, keyHash, chatId) {
  const meta = (await env.KV.get('meta:' + keyHash, 'json')) || { chats: [] };
  if (!meta.chats.includes(chatId)) {
    meta.chats.push(chatId);
    await env.KV.put('meta:' + keyHash, JSON.stringify(meta));
  }
}

async function handleApi(request, env, url) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Вход из Telegram: проверяем подпись, выдаём (или привязываем) ключ синхронизации.
  if (url.pathname === '/api/tg-login' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const user = await verifyInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
    if (!user || !user.id) return json({ error: 'bad initData' }, 401);
    let key = await env.KV.get('tg:' + user.id);
    // привязать этот аккаунт к уже существующему ключу (например, с айфона или с другого аккаунта)
    if (validKey(body.key) && body.key !== key && body.link) key = body.key;
    if (!key) key = validKey(body.key) ? body.key : newKey();
    await env.KV.put('tg:' + user.id, key);
    await addChat(env, await sha256(key), user.id);
    return json({ key });
  }

  const key = bearer(request);
  if (!key) return json({ error: 'no key' }, 401);
  const kh = await sha256(key);

  if (url.pathname === '/api/state' && request.method === 'GET') {
    const st = await env.KV.get('st:' + kh, 'json');
    return json(st || { savedAt: 0, data: null });
  }

  if (url.pathname === '/api/state' && request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.savedAt !== 'number' || !body.data) return json({ error: 'bad body' }, 400);
    const raw = JSON.stringify({ savedAt: body.savedAt, data: body.data });
    if (raw.length > 4_000_000) return json({ error: 'too big' }, 413);
    const cur = await env.KV.get('st:' + kh, 'json');
    // кто сохранил позже, тот и прав; более старую версию не принимаем
    if (cur && cur.savedAt > body.savedAt) return json({ ok: false, newer: cur }, 409);
    await env.KV.put('st:' + kh, raw);
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
}

/* ---------------- напоминания ---------------- */

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const plural = (n, a, b, c) => (n % 100 > 10 && n % 100 < 20 ? c : n % 10 === 1 ? a : n % 10 > 1 && n % 10 < 5 ? b : c);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function mskNow(nowMs) {
  const d = new Date(nowMs + MSK_OFFSET_MIN * 60000); // «московское» время в UTC-полях
  return { date: isoDate(d), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: (d.getUTCDay() + 6) % 7 };
}

const addDaysIso = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };
const mondayIso = (s) => { const d = new Date(s + 'T00:00:00Z'); return addDaysIso(s, -((d.getUTCDay() + 6) % 7)); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

function weekInfo(date, plan) {
  let sem = null;
  for (const s of plan.semesters || []) if (date >= mondayIso(s.start)) sem = s;
  if (!sem || date > sem.vacation[1]) return null;
  const n = Math.floor(daysBetween(mondayIso(sem.start), date) / 7) + 1;
  return { sem, n, numerator: n % 2 === 1, study: date < sem.session[0] };
}

const hiddenBy = (list) => (name) => (list || []).some((h) => h && String(name || '').toLowerCase().startsWith(String(h).toLowerCase()));

function parseLessons(schedule) {
  const items = schedule && schedule.raw && schedule.raw.data && schedule.raw.data.schedule;
  const out = [];
  const seen = new Set();
  for (const x of items || []) {
    const d = x.discipline || {};
    const subject = (typeof d === 'string' ? d : d.fullName || d.shortName || d.abbr || '').trim();
    if (!subject) continue;
    const w = String(x.week || 'all').toLowerCase();
    const week = /^(ch|чс)/.test(w) ? 'ch' : /^(zn|зн)/.test(w) ? 'zn' : 'all';
    const lesson = {
      day: Number(x.day), week, subject,
      start: String(x.startTime || '').slice(0, 5), end: String(x.endTime || '').slice(0, 5),
      type: ACT[String(d.actType || '').toLowerCase()] || '',
      room: (x.audiences || []).map((a) => a && a.name).filter(Boolean).join(', '),
    };
    const k = [lesson.day, lesson.start, lesson.week, lesson.subject, lesson.type, lesson.room].join('|');
    if (!seen.has(k)) { seen.add(k); out.push(lesson); }
  }
  return out;
}

function lessonsOn(date, dow, lessons, plan, isHidden) {
  const w = weekInfo(date, plan);
  if (!w || !w.study) return [];
  return lessons
    .filter((l) => l.day === dow + 1 && (l.week === 'all' || (l.week === 'ch') === w.numerator) && !isHidden(l.subject))
    .sort((a, b) => toMin(a.start) - toMin(b.start));
}

function kmToday(date, dow, lessons, plan, isHidden, kmDone) {
  const w = weekInfo(date, plan);
  if (!w || !w.study) return [];
  const mon = mondayIso(date);
  const out = [];
  for (const subj of w.sem.subjects) {
    if (isHidden(subj.name) || (subj.short && isHidden(subj.short))) continue;
    for (const [wk, kind] of subj.events) {
      if (wk !== w.n || kmDone[`${w.sem.n}|${subj.name}|${wk}|${kind}`]) continue;
      // срок — первая пара по предмету на неделе, иначе пятница (как в приложении)
      let due = addDaysIso(mon, 4);
      for (let i = 0; i < 6; i++) {
        const d = addDaysIso(mon, i);
        if (lessonsOn(d, i, lessons, plan, isHidden).some((l) => l.subject === subj.name)) { due = d; break; }
      }
      if (due === date) out.push({ subject: subj.name, kind });
    }
  }
  return out;
}

async function tgSend(env, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '📖 Открыть ежедневник', web_app: { url: APP_URL } }]] },
    }),
  });
  return r.ok;
}

// Что напомнить пользователю прямо сейчас. Отдельно от отправки — чтобы можно было проверить тестом.
export function dueReminders(state, nowMs, schedule, plan) {
  const data = (state && state.data) || {};
  const settings = data.settings || {};
  const remind = settings.remind || {};
  const lessonMode = remind.lessons || 'first'; // first | all | off
  const tasksOn = remind.tasks !== false;
  const lead = Number(remind.leadMin) || 15;
  const { date, minutes, dow } = mskNow(nowMs);
  const isHidden = hiddenBy(settings.hidden);
  const lessons = [...parseLessons(schedule), ...(data.manual || []).map((l) => ({ ...l, type: ACT[l.type] || '' }))];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const out = [];

  if (lessonMode !== 'off') {
    const today = lessonsOn(date, dow, lessons, plan, isHidden);
    const kms = kmToday(date, dow, lessons, plan, isHidden, data.kmDone || {});
    const seenSubj = new Set();
    today.forEach((l, i) => {
      const first = !seenSubj.has(l.subject);
      seenSubj.add(l.subject);
      if (lessonMode === 'first' && i > 0) return;
      const left = toMin(l.start) - minutes;
      // крон раз в 5 минут: ловим окно (lead-5, lead]
      if (left > lead || left <= lead - 5) return;
      const lines = [`⏰ <b>Через ${left} мин</b> — ${esc(l.subject)}`, `${l.start}–${l.end}${l.type ? ' · ' + l.type : ''}${l.room ? ' · ' + esc(l.room) : ''}`];
      if (first) {
        const hw = tasks.filter((t) => t.subject === l.subject && t.date === date && !t.done);
        const km = kms.filter((e) => e.subject === l.subject);
        if (hw.length || km.length) {
          lines.push('', '<b>Сдать на этой паре:</b>');
          km.forEach((e) => lines.push(`🔴 ${e.kind} — ${KM[e.kind] || e.kind}`));
          hw.forEach((t) => lines.push(`• ${esc(t.title)}`));
        }
      }
      if (lessonMode === 'first' && today.length > 1) lines.push('', `Сегодня ${today.length} ${plural(today.length, 'пара', 'пары', 'пар')}, до ${today[today.length - 1].end}`);
      out.push({ id: `l|${date}|${l.start}|${l.subject}`, text: lines.join('\n') });
    });
  }

  if (tasksOn) {
    for (const t of tasks) {
      if (t.done || t.date !== date || !t.time) continue;
      const delta = minutes - toMin(t.time);
      if (delta < 0 || delta >= 5) continue;
      const lines = [`🔔 <b>${esc(t.title)}</b>`, `${t.time}${t.subject ? ' · ' + esc(t.subject) : ''}`];
      if (t.note) lines.push(esc(t.note));
      out.push({ id: `t|${t.id}|${date}|${t.time}`, text: lines.join('\n') });
    }
  }
  return out;
}

async function runReminders(env, nowMs) {
  const [schedule, planText] = await Promise.all([
    fetch(APP_URL + 'schedule.json', { cf: { cacheTtl: 600 } }).then((r) => r.json()).catch(() => null),
    fetch(APP_URL + 'js/plan.js', { cf: { cacheTtl: 3600 } }).then((r) => r.text()).catch(() => ''),
  ]);
  let plan = { semesters: [] };
  try { plan = JSON.parse(planText.slice(planText.indexOf('{'), planText.lastIndexOf('}') + 1)); } catch { /* без плана — только дела */ }

  let cursor;
  do {
    const page = await env.KV.list({ prefix: 'meta:', cursor });
    for (const { name } of page.keys) {
      const kh = name.slice(5);
      const [meta, state] = await Promise.all([env.KV.get(name, 'json'), env.KV.get('st:' + kh, 'json')]);
      if (!meta || !meta.chats || !meta.chats.length || !state) continue;
      for (const r of dueReminders(state, nowMs, schedule, plan)) {
        const sentKey = `sent:${kh.slice(0, 16)}:${r.id}`;
        if (await env.KV.get(sentKey)) continue;
        await env.KV.put(sentKey, '1', { expirationTtl: 2 * 86400 });
        for (const chat of meta.chats) await tgSend(env, chat, r.text);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env, url); } catch (e) { return json({ error: 'server' }, 500); }
    }
    return new Response('Ежедневник: сервер синхронизации работает.', { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, event.scheduledTime || Date.now()));
  },
};
