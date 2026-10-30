#!/usr/bin/env python3
"""Настраивает Telegram-бота: кнопка «Открыть» с ежедневником, описание, команды.

Безопасно запускать сколько угодно раз. Переменные окружения:
  TELEGRAM_BOT_TOKEN — токен бота от @BotFather
  APP_URL            — адрес приложения (по умолчанию GitHub Pages этого репозитория)
"""
import json
import os
import sys
import urllib.request

APP_URL = os.environ.get("APP_URL", "").strip() or "https://mihailaktaevsm-droid.github.io/bot/"


def call(token: str, method: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> int:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        print("Нет TELEGRAM_BOT_TOKEN — пропускаю настройку бота")
        return 0
    steps = [
        ("setChatMenuButton", {"menu_button": {"type": "web_app", "text": "Открыть", "web_app": {"url": APP_URL}}}),
        ("setMyDescription", {"description": "Ежедневник студента МГТУ им. Баумана: пары из ЛКС, домашка, контрольные недели и дела. "
                                              "Нажми «Открыть» внизу, чтобы запустить. Каждое утро присылаю сводку на день."}),
        ("setMyShortDescription", {"short_description": "Пары, домашка и контрольные — ежедневник студента МГТУ"}),
        ("setMyCommands", {"commands": [{"command": "start", "description": "Начать"}]}),
    ]
    for method, payload in steps:
        res = call(token, method, payload)
        print(f"{method}: {'ok' if res.get('ok') else res}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
