"""Регресс-тесты лайв-инварианта (OTS-56 / баг OTS-55).

Инвариант: ЛЮБОЙ идущий прямо сейчас матч ОБЯЗАН быть в лайв-выдаче /api/matches —
без пропусков, независимо от горизонта ставок, даты и написания названий команд.
Уходит из лайва только когда реально завершился. Краевые (перерыв, доп. время,
послематчевые пенальти) — всё ещё лайв; только что начавшийся — уже лайв.

Это чистая логика (filter_live_view / is_live_status / is_ended_status) — без
живого сервера и БД.

Запуск:  WC2026_TESTING=1 .venv/bin/python tests/test_live.py
"""
import os
import sys
from datetime import datetime, timezone, timedelta

os.environ["WC2026_TESTING"] = "1"  # отключить init_db / TG-тред / preload при импорте
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import server  # noqa: E402
from _harness import suite, eq, ok, main  # noqa: E402

NOW = datetime(2026, 6, 30, 17, 30, tzinfo=timezone.utc)


def mk(status, *, home="Home", away="Away", offset_hours=0.0, date=None, mid=None):
    """Сконструировать нормализованный матч с kickoff = NOW + offset_hours."""
    dt = NOW + timedelta(hours=offset_hours)
    return {
        "id": mid or f"{home}-{away}-{status}",
        "home": home, "away": away,
        "status": status,
        "dateTimeRaw": dt.isoformat(),
        "date": date if date is not None else dt.strftime("%Y-%m-%d"),
    }


def ids(matches):
    return {m["id"] for m in matches}


# ── классификация статусов ────────────────────────────────────────────────────
st = suite("Статусы матча (is_live_status / is_ended_status)")
st.case("status 2 (Not Started) — не live", lambda: eq(server.is_live_status(2), False))
for s in (3, 4, 5, 6, 7):
    st.case(f"status {s} — live (идёт)", (lambda s=s: eq(server.is_live_status(s), True)))
st.case("status 8 (Finished) — не live", lambda: eq(server.is_live_status(8), False))
st.case("status 8 — ended", lambda: eq(server.is_ended_status(8), True))
st.case("status 9 (AET) — ended", lambda: eq(server.is_ended_status(9), True))
st.case("status 10 (After Penalty) — ended", lambda: eq(server.is_ended_status(10), True))
st.case("status 7 (пенальти) — НЕ ended (ещё идёт)", lambda: eq(server.is_ended_status(7), False))
st.case("строковый статус '5' — live", lambda: eq(server.is_live_status("5"), True))
st.case("мусорный статус None — не live и не ended",
        lambda: ok(not server.is_live_status(None) and not server.is_ended_status(None)))


# ── ГЛАВНЫЙ инвариант: идёт ⇒ в лайв-выдаче ──────────────────────────────────
inv = suite("Инвариант OTS-56: матч идёт ⇒ он в лайв-выдаче")

# Идущий матч обязан остаться, что бы ни было с горизонтом/датой/названием.
inv.case(
    "идущий матч присутствует в выдаче (базовый кейс OTS-55)",
    lambda: ok("LIVE" in ids(server.filter_live_view([mk(3, mid="LIVE")], NOW))),
)
inv.case(
    "идущий матч НЕ выпадает за пределы горизонта ставок (kickoff далеко в прошлом)",
    lambda: ok("LIVE" in ids(server.filter_live_view(
        [mk(3, offset_hours=-100, mid="LIVE")], NOW))),
)
inv.case(
    "идущий матч НЕ выпадает с «чужой» датой (не сегодня/вчера)",
    lambda: ok("LIVE" in ids(server.filter_live_view(
        [mk(5, date="2025-01-01", mid="LIVE")], NOW))),
)
inv.case(
    "вариативное название команды (Côte d'Ivoire) не выкидывает идущий матч",
    lambda: ok("CIV" in ids(server.filter_live_view(
        [mk(3, home="Côte d'Ivoire", away="Norway", mid="CIV")], NOW))),
)
# Все краевые live-статусы остаются в лайве.
for s, name in [(4, "перерыв"), (6, "доп. время"), (7, "послематч. пенальти")]:
    inv.case(
        f"краевой случай остаётся в лайве: {name} (status {s})",
        (lambda s=s: ok("E" in ids(server.filter_live_view([mk(s, mid="E")], NOW)))),
    )
# Только что начавшийся (граница старта) — уже в лайве.
inv.case(
    "матч на границе старта (kickoff = сейчас, status 3) — в лайве",
    lambda: ok("E" in ids(server.filter_live_view([mk(3, offset_hours=0, mid="E")], NOW))),
)
# Полный «коктейль»: live-матч с кучей отягчающих не должен потеряться среди прочих.
inv.case(
    "идущий матч переживает все фильтры в смешанном списке",
    lambda: ok("LIVE" in ids(server.filter_live_view([
        mk(2, offset_hours=200, mid="FAR_FUTURE"),         # за горизонтом — отсекаем
        mk(8, date="2020-01-01", mid="OLD_DONE"),          # старый завершённый — отсекаем
        mk(6, offset_hours=-3, date="2000-01-01",
           home="Côte d'Ivoire", away="Norway", mid="LIVE"),  # идёт — ОБЯЗАН остаться
    ], NOW))),
)


# ── уход из лайва только по завершении + горизонт upcoming ────────────────────
ph = suite("Фазы: ended/upcoming фильтруются корректно")
ph.case("завершённый сегодня — в выдаче (свежий результат)",
        lambda: ok("E" in ids(server.filter_live_view([mk(8, offset_hours=-2, mid="E")], NOW))))
ph.case("завершённый давно (не сегодня/вчера) — НЕ в выдаче",
        lambda: ok("E" not in ids(server.filter_live_view(
            [mk(8, offset_hours=-200, date="2025-01-01", mid="E")], NOW))))
ph.case("upcoming в пределах горизонта (через 2ч) — в выдаче",
        lambda: ok("U" in ids(server.filter_live_view([mk(2, offset_hours=2, mid="U")], NOW))))
ph.case("upcoming за горизонтом (через 200ч) — НЕ в выдаче",
        lambda: ok("U" not in ids(server.filter_live_view([mk(2, offset_hours=200, mid="U")], NOW))))


# ── busting кэша при наступившем kickoff ──────────────────────────────────────
cb = suite("Кэш: пере-фетч когда upcoming-матч уже должен идти")
cb.case("upcoming с уже наступившим kickoff — кэш устарел (True)",
        lambda: eq(server._cache_has_stale_kickoff([mk(2, offset_hours=-0.1)], NOW), True))
cb.case("upcoming в будущем — кэш ещё валиден (False)",
        lambda: eq(server._cache_has_stale_kickoff([mk(2, offset_hours=1)], NOW), False))
cb.case("уже live в кэше — это не «застрявший upcoming» (False)",
        lambda: eq(server._cache_has_stale_kickoff([mk(3, offset_hours=-0.1)], NOW), False))
cb.case("пустой кэш — False", lambda: eq(server._cache_has_stale_kickoff([], NOW), False))


if __name__ == "__main__":
    main(st, inv, ph, cb)
