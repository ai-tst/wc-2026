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
classify = server._classify_knockout
stage = server._stage_points


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


# классификация раунда плей-офф (зеркало classifyKnockoutRound в points.js)
ko = suite("Раунды плей-офф (_classify_knockout)")
ko.case("Round of 32 -> R32", lambda: eq(classify("Round of 32"), "R32"))
ko.case("Round of 16 -> R16", lambda: eq(classify("Round of 16"), "R16"))
ko.case("Quarter-final -> QF", lambda: eq(classify("Quarter-final"), "QF"))
ko.case("Semi-final -> SF (а не F)", lambda: eq(classify("Semi-final"), "SF"))
ko.case("Final -> F", lambda: eq(classify("Final"), "F"))
ko.case("групповой -> None", lambda: eq(classify("Group A"), None))

# OTS-30: плоские таблицы очков по этапам (golden — синхронны со STAGE_POINTS в points.js)
stg = suite("Таблицы очков по этапам (_stage_points, OTS-30)")
stg.case("группа -> 1/2/2", lambda: eq(stage("Group A"), {"outcome": 1, "exact": 2, "player": 2}))
stg.case("R32 -> 2/4/3",    lambda: eq(stage("Round of 32"), {"outcome": 2, "exact": 4, "player": 3}))
stg.case("R16 -> 2/4/3",    lambda: eq(stage("Round of 16"), {"outcome": 2, "exact": 4, "player": 3}))
stg.case("QF -> 3/5/4",     lambda: eq(stage("Quarter-final"), {"outcome": 3, "exact": 5, "player": 4}))
stg.case("SF -> 3/5/4",     lambda: eq(stage("Semi-final"), {"outcome": 3, "exact": 5, "player": 4}))
stg.case("Финал -> 4/6/5",  lambda: eq(stage("Final"), {"outcome": 4, "exact": 6, "player": 5}))


# OTS-21/30: плей-офф — исход (кто прошёл) по выбору advance; исход и точный счёт
# СУММИРУЮТСЯ, без бонуса. _playoff_match_points -> (total, outcome, exact, player, pts).
teams_eq = server._teams_eq
winner_from_score = server._playoff_winner_from_score
pp = server._playoff_match_points
full = lambda *a: pp(*a)[0]        # полные очки матча
quad = lambda *a: pp(*a)[:4]       # (total, outcome, exact, player) без таблицы

po = suite("Плей-офф: исход = кто прошёл, исход+точный суммируются (OTS-30)")
# сопоставление команд
po.case("teams_eq игнорит регистр/пробелы", lambda: ok(teams_eq("Дом", "  дом ")))
po.case("teams_eq разные = нет", lambda: ok(not teams_eq("Дом", "Гости")))
po.case("winner_from_score решающий", lambda: eq(winner_from_score("Дом", "Гости", 2, 0), "Дом"))
po.case("winner_from_score ничья -> '' (нужен админ)", lambda: eq(winner_from_score("Дом", "Гости", 1, 1), ""))
# групповой этап — исход по счёту, таблица группы
po.case("группа: исход по счёту 1",
        lambda: eq(quad("1", "0", "X", "Дом", "2", "0", "Y", "Дом", "Group A"), (1, True, False, False)))
po.case("группа: точный счёт = исход+точный = 1+2 = 3",
        lambda: eq(quad("2", "0", "X", "Дом", "2", "0", "Y", "Дом", "Group A"), (3, True, True, False)))
# плей-офф: проход верный, счёт мимо -> только исход этапа
po.case("R32 проход верный, счёт мимо -> 2",
        lambda: eq(full("1", "0", "X", "Дом", "2", "0", "Y", "Дом", "Round of 32"), 2))
# точный счёт + проход СУММИРУЮТСЯ
po.case("R16 точный + проход -> исход2 + точный4 = 6",
        lambda: eq(full("2", "0", "X", "Дом", "2", "0", "Y", "Дом", "Round of 16"), 6))
po.case("Финал точный + проход -> исход4 + точный6 = 10",
        lambda: eq(full("2", "1", "X", "Дом", "2", "1", "Y", "Дом", "Final"), 10))
po.case("SF точный + проход + игрок -> 3+5+4 = 12",
        lambda: eq(full("2", "1", "Messi", "Дом", "2", "1", "Messi", "Дом", "Semi-final"), 12))
# независимость: точный счёт, но проход выбран неверно -> только точный (исход не капает)
po.case("R16 точный счёт, проход НЕверный -> только точный4 = 4",
        lambda: eq(full("2", "0", "X", "Гости", "2", "0", "Y", "Дом", "Round of 16"), 4))
po.case("R16 точный счёт, проход НЕверный: outcome=False",
        lambda: eq(quad("2", "0", "X", "Гости", "2", "0", "Y", "Дом", "Round of 16"), (4, False, True, False)))
# ничья -> пенальти: счёт без пенальти точный, проход по вердикту админа
po.case("QF ничья 1:1, точный + проход верный -> 3+5 = 8",
        lambda: eq(full("1", "1", "X", "Дом", "1", "1", "Y", "Дом", "Quarter-final"), 8))
po.case("QF ничья 1:1, точный есть, проход НЕверный -> только точный5 = 5",
        lambda: eq(full("1", "1", "X", "Гости", "1", "1", "Y", "Дом", "Quarter-final"), 5))
po.case("всё мимо -> 0",
        lambda: eq(full("0", "3", "X", "Гости", "2", "0", "Y", "Дом", "Quarter-final"), 0))

# OTS-27: advance пустой -> исход выводим из предсказанного счёта (как в группе).
po.case("R32 advance пустой, счёт-исход верный, счёт мимо -> 2",
        lambda: eq(full("0", "2", "X", "", "0", "1", "Y", "Гости", "Round of 32", "Дом", "Гости"), 2))
po.case("R32 advance пустой, точный счёт -> исход2 + точный4 = 6",
        lambda: eq(full("0", "1", "X", "", "0", "1", "Y", "Гости", "Round of 32", "Дом", "Гости"), 6))
po.case("R32 advance пустой, исход мимо -> 0",
        lambda: eq(full("2", "0", "X", "", "0", "1", "Y", "Гости", "Round of 32", "Дом", "Гости"), 0))
po.case("R32 advance пустой, предсказана ничья -> исход не выбран, 0",
        lambda: eq(quad("1", "1", "X", "", "0", "1", "Y", "Гости", "Round of 32", "Дом", "Гости"),
                   (0, False, False, False)))
po.case("R32 advance задан, бьёт счёт: advance верный, счёт-исход мимо -> 2",
        lambda: eq(full("2", "0", "X", "Гости", "0", "1", "Y", "Гости", "Round of 32", "Дом", "Гости"), 2))


if __name__ == "__main__":
    main(points, edge, players, nrm, ko, stg, po)
