"""Smoke / contract регресс-тесты против ЖИВОГО сервера.

ТОЛЬКО read-only запросы — никаких записей в прод-БД. Проверяем, что ключевые
эндпоинты живы, отдают корректный HTTP-код и не сломали JSON-контракт, а также
что приватные эндпоинты по-прежнему закрыты авторизацией.

База по умолчанию: http://127.0.0.1:8000  (переопределить: BASE_URL=... )
Запуск:  .venv/bin/python tests/test_smoke.py
"""
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import suite, eq, ok, main  # noqa: E402

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def fetch(path):
    """-> (status, body_text). Не кидает на 4xx/5xx."""
    req = urllib.request.Request(BASE + path, headers={"Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def get_json(path):
    status, body = fetch(path)
    return status, json.loads(body)


# ── доступность статики/страницы ──────────────────────────────────────────────
pages = suite("Страница и статика")


def _home():
    st, body = fetch("/")
    eq(st, 200, "GET / статус")
    ok("<!DOCTYPE html" in body or "<!doctype html" in body.lower(), "GET / отдаёт HTML")


pages.case("GET / отдаёт HTML 200", _home)
pages.case("GET /styles.css 200", lambda: eq(fetch("/styles.css")[0], 200))
pages.case("GET /app.js 200", lambda: eq(fetch("/app.js")[0], 200))


# ── публичные read-API: код + форма ответа ────────────────────────────────────
public_api = suite("Публичные API (контракт ответа)")


def _matches():
    st, data = get_json("/api/matches")
    eq(st, 200, "статус")
    ok(isinstance(data, (list, dict)), "matches — list или dict")


def _leaderboard():
    st, data = get_json("/api/leaderboard")
    eq(st, 200, "статус")
    for key in ("users", "actualMatches", "actualOutrights"):
        ok(key in data, f"в ответе есть '{key}'")
    ok(isinstance(data["users"], list), "users — список")


def _actual_outrights():
    st, data = get_json("/api/actual/outrights")
    eq(st, 200, "статус")
    for key in ("winner", "bestPlayer", "topScorer", "darkHorse"):
        ok(key in data, f"в ответе есть '{key}'")


public_api.case("GET /api/matches", _matches)
public_api.case("GET /api/leaderboard + форма", _leaderboard)
public_api.case("GET /api/actual/outrights + форма", _actual_outrights)


# ── защита приватных эндпоинтов (регресс безопасности) ─────────────────────────
auth = suite("Авторизация закрывает приватное")
auth.case("GET /api/predictions без сессии -> 401", lambda: eq(fetch("/api/predictions")[0], 401))
auth.case("GET /api/outrights без сессии -> 401", lambda: eq(fetch("/api/outrights")[0], 401))
auth.case("GET /api/admin/overview без сессии -> 401/403", lambda: ok(fetch("/api/admin/overview")[0] in (401, 403)))


def _me_anon():
    st, _ = get_json("/api/auth/me")
    ok(st in (200, 401), "auth/me для анонима -> 200(null) или 401")


auth.case("GET /api/auth/me для анонима", _me_anon)


if __name__ == "__main__":
    print(f"BASE_URL = {BASE}")
    main(pages, public_api, auth)
