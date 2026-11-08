#!/usr/bin/env python3
"""Готовит Cloudflare к развёртыванию сервера (запускается в GitHub Actions).

1. Находит id аккаунта по токену.
2. Создаёт хранилище KV «bmstu-planner», если его ещё нет, и вписывает id в worker/wrangler.toml.
3. Включает поддомен workers.dev, если у аккаунта его ещё нет.
Пишет account_id и subdomain в $GITHUB_OUTPUT.
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
ROOT = pathlib.Path(__file__).resolve().parent.parent


def cf(method: str, path: str, body=None):
    req = urllib.request.Request(API + path, method=method, headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}") or {"success": False, "errors": [{"message": str(e)}]}


def fail(msg: str, res=None):
    print(f"::error::{msg}" + (f" — {res.get('errors')}" if res else ""))
    sys.exit(1)


def main() -> int:
    res = cf("GET", "/accounts")
    if not res.get("success") or not res.get("result"):
        fail("Токен Cloudflare не подходит: создай его по шаблону «Edit Cloudflare Workers»", res)
    account = res["result"][0]["id"]

    res = cf("GET", f"/accounts/{account}/storage/kv/namespaces?per_page=100")
    if not res.get("success"):
        fail("Нет доступа к Workers KV — у токена должны быть права Workers KV Storage: Edit", res)
    ns = next((n["id"] for n in res["result"] if n["title"] == "bmstu-planner"), None)
    if not ns:
        res = cf("POST", f"/accounts/{account}/storage/kv/namespaces", {"title": "bmstu-planner"})
        if not res.get("success"):
            fail("Не удалось создать KV", res)
        ns = res["result"]["id"]
        print("Создано хранилище KV")
    toml = ROOT / "worker" / "wrangler.toml"
    toml.write_text(toml.read_text("utf-8").replace("KV_NAMESPACE_ID", ns), "utf-8")

    res = cf("GET", f"/accounts/{account}/workers/subdomain")
    sub = (res.get("result") or {}).get("subdomain") if res.get("success") else None
    if not sub:
        for name in (f"planner-{account[:8]}", f"bmstu-planner-{account[:12]}"):
            res = cf("PUT", f"/accounts/{account}/workers/subdomain", {"subdomain": name})
            if res.get("success"):
                sub = name
                print(f"Включён поддомен {sub}.workers.dev")
                break
        if not sub:
            fail("Не удалось включить workers.dev: открой dash.cloudflare.com → Workers & Pages один раз и запусти снова", res)

    print(f"Аккаунт {account[:6]}…, KV готово, поддомен {sub}.workers.dev")
    with open(os.environ.get("GITHUB_OUTPUT", os.devnull), "a") as f:
        f.write(f"account_id={account}\nsubdomain={sub}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
