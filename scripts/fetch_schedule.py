#!/usr/bin/env python3
"""Скачивает расписание группы из ЛКС МГТУ им. Баумана в schedule.json.

Запускается GitHub Actions раз в день. Приложение само разбирает
ответ ЛКС, поэтому здесь он сохраняется как есть (в поле "raw").

Переменные окружения:
  GROUP       — название группы, например Э5-11Б
  GROUP_UUID  — (необязательно) uuid группы из ссылки на расписание в ЛКС
"""
import datetime as dt
import json
import os
import pathlib
import re
import sys
import urllib.request

API = "https://lks.bmstu.ru/lks-back/api/v1"
OUT = pathlib.Path(__file__).resolve().parent.parent / "schedule.json"

# латинские буквы, похожие на кириллические, и «6» вместо «Б» в конце
LOOKALIKE = str.maketrans("ABCEHKMOPTXY", "АВСЕНКМОРТХУ")


def norm(name: str) -> str:
    s = re.sub(r"\s+", "", str(name or "")).upper().translate(LOOKALIKE)
    return re.sub(r"/?6$", "Б", s)


def get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (planner schedule sync)", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


def find_group_uuid(group: str) -> str:
    structure = get(f"{API}/structure")
    want = norm(group)
    candidates = []
    for n in walk(structure):
        names = [n.get(k) for k in ("abbr", "name", "title") if isinstance(n.get(k), str)]
        if n.get("uuid") and any(norm(x) == want for x in names):
            candidates.append(n)
    groups = [c for c in candidates if str(c.get("nodeType", "")).lower() == "group"] or candidates
    if not groups:
        raise SystemExit(f"Группа {group!r} не найдена в структуре ЛКС")
    return groups[0]["uuid"]


def main() -> int:
    group = os.environ.get("GROUP", "Э5-11Б").strip()
    uuid = os.environ.get("GROUP_UUID", "").strip() or find_group_uuid(group)
    print(f"Группа {group}, uuid {uuid}")
    raw = get(f"{API}/schedules/groups/{uuid}/public")

    old = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text("utf-8"))
        except ValueError:
            pass
    if old.get("raw") == raw and old.get("uuid") == uuid:
        print("Расписание не изменилось")
        return 0

    title = ""
    data = raw.get("data") if isinstance(raw, dict) else None
    if isinstance(data, dict):
        title = data.get("title") or ""
    out = {
        "group": group,
        "uuid": uuid,
        "title": title,
        "fetchedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "raw": raw,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"Сохранено в {OUT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
