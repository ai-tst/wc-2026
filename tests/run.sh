#!/usr/bin/env bash
# Регресс-набор «Отсоса». Запускать ПЕРЕД каждым релизом.
#
#   bash tests/run.sh            # всё: логика (py+js) + smoke по локальному серверу
#   bash tests/run.sh --logic    # только чистая логика (без живого сервера)
#   BASE_URL=https://51.250.35.235.sslip.io bash tests/run.sh   # smoke по проду
#
# Код возврата != 0 — релиз НЕ катим.
set -u

# корень app/ (родитель tests/), независимо от того, откуда вызвали
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR" || exit 2

PY="$APP_DIR/.venv/bin/python"
[ -x "$PY" ] || PY="python3"

fail=0
run() { echo; echo "▶ $1"; shift; "$@" || fail=1; }

run "Python: расчёт очков и матчинг (unit)" \
    env WC2026_TESTING=1 "$PY" tests/test_scoring.py
run "Python: лайв-инвариант «идёт ⇒ в лайве» (unit, OTS-56)" \
    env WC2026_TESTING=1 "$PY" tests/test_live.py
run "JS: клиентский расчёт очков (unit, паритет)" \
    node tests/test_points.mjs
run "JS: «Матчи сёдня» — идущий матч виден и сверху (unit, OTS-56)" \
    node tests/test_today_matches.mjs

if [ "${1:-}" != "--logic" ]; then
  run "HTTP smoke по живому серверу (${BASE_URL:-http://127.0.0.1:8000})" \
      "$PY" tests/test_smoke.py
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "✅ Все регресс-тесты прошли — можно катить."
else
  echo "❌ Есть провалы — релиз НЕ катим, чиним."
fi
exit "$fail"
