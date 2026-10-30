#!/usr/bin/env python3
"""Утренняя сводка в Telegram: пары на сегодня, контрольные и сроки из учебного плана.

Запускается GitHub Actions каждое утро. Берёт расписание из schedule.json
и учебный план из js/plan.js — те же данные, что и приложение.

Переменные окружения:
  TELEGRAM_BOT_TOKEN — токен бота от @BotFather (обязательно)
  TELEGRAM_CHAT_ID   — куда слать; если не задан, берётся чат последнего,
                       кто написал боту (нужно написать боту /start)
  HIDDEN             — скрытые предметы через запятую (по умолчанию ФКиС)
  TODAY              — дата YYYY-MM-DD вместо сегодняшней (для проверки)
  DRY_RUN=1          — только напечатать сообщение, не отправлять
"""
import datetime as dt
import html
import json
import os
import pathlib
import sys
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
MSK = dt.timezone(dt.timedelta(hours=3))

DOW = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
DOW_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
ACT = {"lecture": "лек", "seminar": "сем", "lab": "лаб"}
KM = {"ДЗ": "сдача ДЗ", "РК": "рубежный контроль", "КР": "контрольная", "М": "закрытие модуля", "Р": "реферат"}
KM_ORDER = ["РК", "КР", "ДЗ", "Р", "М"]


def esc(s) -> str:
    return html.escape(str(s or ""), quote=False)


def plural(n: int, one: str, few: str, many: str) -> str:
    if 10 < n % 100 < 20:
        return many
    return one if n % 10 == 1 else few if 1 < n % 10 < 5 else many


def monday(d: dt.date) -> dt.date:
    return d - dt.timedelta(days=d.weekday())


def fmt_day(d: dt.date) -> str:
    return f"{d.day} {MONTHS[d.month - 1]}"


def load_plan() -> dict:
    s = (ROOT / "js" / "plan.js").read_text("utf-8")
    return json.loads(s[s.index("{"): s.rindex("}") + 1])


def hidden_list() -> list:
    return [h.strip().lower() for h in os.environ.get("HIDDEN", "ФКиС").split(",") if h.strip()]


def is_hidden(name: str, hidden: list) -> bool:
    return any(str(name or "").lower().startswith(h) for h in hidden)


# ---------- расписание из ЛКС ----------

def load_lessons(hidden: list) -> list:
    data = json.loads((ROOT / "schedule.json").read_text("utf-8"))
    raw = data.get("raw") or {}
    items = (raw.get("data") or {}).get("schedule") if isinstance(raw, dict) else None
    lessons, seen = [], set()
    for x in items or []:
        d = x.get("discipline") or {}
        name = (d.get("fullName") or d.get("shortName") or d.get("abbr") or "").strip() if isinstance(d, dict) else str(d)
        if not name or is_hidden(name, hidden):
            continue
        week = str(x.get("week") or "all").lower()
        week = "ch" if week.startswith(("ch", "чс")) else "zn" if week.startswith(("zn", "зн")) else "all"
        start, end = str(x.get("startTime", ""))[:5], str(x.get("endTime", ""))[:5]
        rooms = ", ".join(a.get("name", "") for a in x.get("audiences") or [] if a.get("name"))
        teachers = ", ".join(
            f"{t.get('lastName', '')} {(t.get('firstName') or ' ')[0]}.{(t.get('middleName') or ' ')[0]}.".replace(" .", "").strip()
            for t in x.get("teachers") or [] if t.get("lastName")
        )
        act = ACT.get(str(d.get("actType", "")).lower(), "") if isinstance(d, dict) else ""
        key = (x.get("day"), start, week, name, act, rooms)
        if key in seen:
            continue
        seen.add(key)
        lessons.append(dict(day=int(x.get("day") or 0), week=week, start=start, end=end, name=name, act=act, room=rooms, teacher=teachers))
    return lessons


# ---------- семестр и недели ----------

def semester_for(d: dt.date, plan: dict):
    cur = None
    for sem in plan["semesters"]:
        if d >= monday(dt.date.fromisoformat(sem["start"])):
            cur = sem
    if cur and d <= dt.date.fromisoformat(cur["vacation"][1]):
        return cur
    return None


def week_info(d: dt.date, plan: dict) -> dict:
    sem = semester_for(d, plan)
    if not sem:
        return dict(sem=None, n=0, numerator=False, study=False, session=False, vacation=False)
    n = (d - monday(dt.date.fromisoformat(sem["start"]))).days // 7 + 1
    s0, s1 = (dt.date.fromisoformat(x) for x in sem["session"])
    return dict(sem=sem, n=n, numerator=n % 2 == 1, study=d < s0, session=s0 <= d <= s1, vacation=d > s1)


def lessons_on(d: dt.date, lessons: list, plan: dict) -> list:
    w = week_info(d, plan)
    if not w["study"]:
        return []
    ok = {"all", "ch" if w["numerator"] else "zn"}
    return sorted((l for l in lessons if l["day"] == d.isoweekday() and l["week"] in ok), key=lambda l: l["start"])


def km_for_week(sem: dict, week: int, lessons: list, plan: dict, hidden: list) -> list:
    mon = monday(dt.date.fromisoformat(sem["start"])) + dt.timedelta(weeks=week - 1)
    out = []
    for subj in sem["subjects"]:
        if is_hidden(subj["name"], hidden) or is_hidden(subj.get("short", ""), hidden):
            continue
        for w, kind in subj["events"]:
            if w != week:
                continue
            # срок — первая пара по предмету на этой неделе, иначе пятница
            due = next((mon + dt.timedelta(days=i) for i in range(6)
                        if any(l["name"] == subj["name"] for l in lessons_on(mon + dt.timedelta(days=i), lessons, plan))),
                       mon + dt.timedelta(days=4))
            out.append(dict(subject=subj["name"], kind=kind, due=due))
    return sorted(out, key=lambda e: (e["due"], KM_ORDER.index(e["kind"]) if e["kind"] in KM_ORDER else 9, e["subject"]))


# ---------- сообщение ----------

def km_line(e: dict, with_day: bool = True) -> str:
    day = f" ({DOW_SHORT[e['due'].weekday()]})" if with_day else ""
    return f"<b>{esc(e['kind'])}</b> {esc(e['subject'])}{day}"


def lessons_block(day_lessons: list) -> list:
    out = []
    for l in day_lessons:
        meta = " · ".join(x for x in (l["act"], l["room"]) if x)
        out.append(f"<code>{l['start']}–{l['end']}</code> {esc(l['name'])}" + (f"\n         <i>{esc(meta)}</i>" if meta else ""))
    return out


def build_message(today: dt.date) -> str:
    plan = load_plan()
    hidden = hidden_list()
    lessons = load_lessons(hidden)
    w = week_info(today, plan)
    sem = w["sem"]
    lines = []

    if w["session"]:
        s1 = dt.date.fromisoformat(sem["session"][1])
        exams = [s["name"] for s in sem["subjects"] if "экз" in s["exam"] and not is_hidden(s["name"], hidden)]
        lines.append(f"📚 <b>{DOW[today.weekday()].capitalize()}, {fmt_day(today)}</b> · сессия")
        lines.append(f"До конца сессии {(s1 - today).days} дн.")
        if exams:
            lines += ["", "<b>Экзамены</b>"] + [f"• {esc(x)}" for x in exams]
        return "\n".join(lines)
    if not w["study"]:
        return ""  # каникулы или вне плана — не беспокоим

    # воскресенье: обзор следующей недели
    if today.weekday() == 6:
        nxt = today + dt.timedelta(days=1)
        nw = week_info(nxt, plan)
        if not nw["study"]:
            return ""
        lines.append(f"🗓 <b>Неделя {nw['n']}</b> · {'числитель' if nw['numerator'] else 'знаменатель'}, с {fmt_day(nxt)}")
        lines += ["", "<b>Пары</b>"]
        for i in range(6):
            d = nxt + dt.timedelta(days=i)
            ls = lessons_on(d, lessons, plan)
            lines.append(f"{DOW_SHORT[i]} — " + (f"{ls[0]['start']}–{ls[-1]['end']}, {len(ls)} {plural(len(ls), 'пара', 'пары', 'пар')}" if ls else "выходной"))
        kms = km_for_week(sem, nw["n"], lessons, plan, hidden)
        if kms:
            lines += ["", "<b>Контрольные на неделе</b>"] + [f"• {km_line(e)}" for e in kms]
        return "\n".join(lines)

    lines.append(f"☀️ <b>{DOW[today.weekday()].capitalize()}, {fmt_day(today)}</b>")
    lines.append(f"{w['n']} неделя · {'числитель' if w['numerator'] else 'знаменатель'}")

    day_lessons = lessons_on(today, lessons, plan)
    lines.append("")
    if day_lessons:
        lines.append(f"<b>Пары</b> ({len(day_lessons)})")
        lines += lessons_block(day_lessons)
    else:
        lines.append("Пар нет — свободный день 🎉")

    kms = km_for_week(sem, w["n"], lessons, plan, hidden)
    tomorrow = today + dt.timedelta(days=1)
    today_km = [e for e in kms if e["due"] == today]
    tomorrow_km = [e for e in kms if e["due"] == tomorrow]
    later_km = [e for e in kms if e["due"] > tomorrow and e["due"] <= monday(today) + dt.timedelta(days=6)]
    if today_km or tomorrow_km or later_km:
        lines += ["", "<b>Контрольные</b>"]
        lines += [f"🔴 сегодня: {km_line(e, False)} — {KM.get(e['kind'], e['kind'])}" for e in today_km]
        lines += [f"🟠 завтра: {km_line(e, False)} — {KM.get(e['kind'], e['kind'])}" for e in tomorrow_km]
        lines += [f"• {km_line(e)}" for e in later_km]

    s0 = dt.date.fromisoformat(sem["session"][0])
    left = (s0 - today).days
    if left <= 30:
        lines += ["", f"⏳ До сессии {left} дн."]
    return "\n".join(lines)


# ---------- Telegram ----------

def tg(token: str, method: str, params: dict) -> dict:
    data = urllib.parse.urlencode(params).encode()
    with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/{method}", data=data, timeout=30) as r:
        return json.load(r)


def find_chat(token: str) -> str:
    updates = tg(token, "getUpdates", {}).get("result", [])
    for u in reversed(updates):
        msg = u.get("message") or u.get("edited_message") or {}
        chat = msg.get("chat") or {}
        if chat.get("type") == "private":
            return str(chat["id"])
    return ""


def main() -> int:
    today = dt.date.fromisoformat(os.environ["TODAY"]) if os.environ.get("TODAY") else dt.datetime.now(MSK).date()
    text = build_message(today)
    if not text:
        print("Сегодня сводка не нужна (каникулы или нет учёбы)")
        return 0
    if os.environ.get("DRY_RUN"):
        print(text)
        return 0

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        print("Нет TELEGRAM_BOT_TOKEN: добавь токен бота в Settings → Secrets and variables → Actions")
        return 1
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip() or find_chat(token)
    if not chat:
        print("Не знаю, куда писать: отправь своему боту /start в Telegram и запусти workflow ещё раз")
        return 1
    if not os.environ.get("TELEGRAM_CHAT_ID"):
        print(f"Чат найден: {chat}. Сохрани его в секрет TELEGRAM_CHAT_ID, иначе через сутки бот его забудет.")
    app_url = os.environ.get("APP_URL", "").strip() or "https://mihailaktaevsm-droid.github.io/bot/"
    keyboard = {"inline_keyboard": [[{"text": "📖 Открыть ежедневник", "web_app": {"url": app_url}}]]}
    res = tg(token, "sendMessage", {"chat_id": chat, "text": text, "parse_mode": "HTML",
                                    "disable_web_page_preview": "true", "reply_markup": json.dumps(keyboard)})
    print("Отправлено" if res.get("ok") else f"Ошибка Telegram: {res}")
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
