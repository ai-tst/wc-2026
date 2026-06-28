"""Регресс-тесты на расчёт очков и матчинг игроков (server.py).

Это серверная половина логики, которая дублируется в public/points.js.
Golden-значения тут ОБЯЗАНЫ совпадать с tests/test_points.mjs — если правишь
правила начисления, правь оба файла, иначе TG-сообщения и таблица разойдутся.

Запуск:  WC2026_TESTING=1 .venv/bin/python tests/test_scoring.py
"""
import os
import sys

os.environ["WC2026_TESTING"] = "1"  # отключить init_db / TG-тред / preload при импорте
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import server  # noqa: E402
from _harness import suite, eq, ok, main  # noqa: E402

calc = server._calc_match_points
pmatch = server._players_match
norm = server._norm_player


# _calc_match_points возвращает (total, outcome, exact, player)
points = suite("Очки за матч (_calc_match_points)")
points.case("точный счёт + игрок = 5", lambda: eq(calc("3", "1", "Messi", "3", "1", "Messi"), (5, True, True, True)))
points.case("точный счёт без игрока = 3", lambda: eq(calc("2", "2", "X", "2", "2", "Y"), (3, True, True, False)))
points.case("исход угадан, счёт мимо = 1", lambda: eq(calc("2", "0", "X", "5", "1", "Y"), (1, True, False, False)))
points.case("исход + игрок = 3", lambda: eq(calc("2", "0", "Messi", "5", "1", "Messi"), (3, True, False, True)))
points.case("только игрок (исход мимо) = 2", lambda: eq(calc("0", "2", "Messi", "3", "1", "Messi"), (2, False, False, True)))
points.case("всё мимо = 0", lambda: eq(calc("0", "2", "X", "3", "1", "Y"), (0, False, False, False)))
points.case("ничья предсказана и сыграна = исход", lambda: eq(calc("1", "1", "X", "2", "2", "Y"), (1, True, False, False)))
points.case("ничья vs победа = 0", lambda: eq(calc("1", "1", "X", "2", "1", "Y")[0], 0))
points.case("точная ничья 0:0 = 3", lambda: eq(calc("0", "0", "X", "0", "0", "Y"), (3, True, True, False)))

# крайние случаи парсинга
edge = suite("Очки — крайние случаи ввода")
edge.case("пустой прогноз = 0", lambda: eq(calc("", "", "X", "1", "0", "Y"), (0, False, False, False)))
edge.case("None в прогнозе = 0", lambda: eq(calc(None, None, "X", "1", "0", "Y"), (0, False, False, False)))
edge.case("нечисловой счёт = 0", lambda: eq(calc("a", "b", "X", "1", "0", "Y"), (0, False, False, False)))
edge.case("нет фактического результата = 0", lambda: eq(calc("1", "0", "X", "", "", "Y"), (0, False, False, False)))
edge.case("счёт как int (не str) тоже считается", lambda: eq(calc(1, 0, "X", 1, 0, "X")[0], 5))

# матчинг имён игроков
players = suite("Матчинг игроков (_players_match)")
players.case("точное совпадение", lambda: ok(pmatch("Lionel Messi", "Lionel Messi")))
players.case("разный регистр", lambda: ok(pmatch("lionel messi", "LIONEL MESSI")))
players.case("диакритика игнорируется", lambda: ok(pmatch("Kylian Mbappe", "Kylian Mbappé")))
players.case("средние имена различаются, фамилия+имя совпали",
             lambda: ok(pmatch("Vinicius Junior", "Vinicius Jose Paixao de Oliveira Junior")))
players.case("сокращённое имя 'J.' = 'Julian'", lambda: ok(pmatch("J. Alvarez", "Julian Alvarez")))
players.case("сокращённое имя в обратную сторону", lambda: ok(pmatch("Julian Alvarez", "J. Alvarez")))
players.case("разные фамилии = нет", lambda: ok(not pmatch("Lionel Messi", "Lionel Ronaldo")))
players.case("разные имена, та же фамилия = нет", lambda: ok(not pmatch("Lionel Messi", "Diego Messi")))
players.case("пустая строка = нет", lambda: ok(not pmatch("", "Messi")))
players.case("обе пустые = нет", lambda: ok(not pmatch("", "")))

# нормализация
nrm = suite("Нормализация имени (_norm_player)")
nrm.case("снимает диакритику и регистр", lambda: eq(norm("Mbappé"), "mbappe"))
nrm.case("тримит пробелы", lambda: eq(norm("  Messi  "), "messi"))
nrm.case("пустое -> ''", lambda: eq(norm(None), ""))


if __name__ == "__main__":
    main(points, edge, players, nrm)
