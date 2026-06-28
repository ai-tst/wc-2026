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
bonus = server._bracket_bonus


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

# честный бонус плей-офф (golden — синхронен с BRACKET_BONUS в points.js, OTS-20)
brk = suite("Бонус плей-офф (_bracket_bonus)")
brk.case("групповой -> 0", lambda: eq(bonus("Group A", True, True), 0))
brk.case("R32 исход -> 1", lambda: eq(bonus("Round of 32", True, False), 1))
brk.case("R32 точный -> только исход 1 (точный +0)", lambda: eq(bonus("Round of 32", True, True), 1))
brk.case("R16 точный -> исход 1 + точный 1 = 2", lambda: eq(bonus("Round of 16", True, True), 2))
brk.case("QF точный -> 2 + 1 = 3", lambda: eq(bonus("Quarter-final", True, True), 3))
brk.case("SF точный -> 4 + 2 = 6", lambda: eq(bonus("Semi-final", True, True), 6))
brk.case("Финал точный -> 8 + 4 = 12", lambda: eq(bonus("Final", True, True), 12))
brk.case("Финал исход без точного -> 8", lambda: eq(bonus("Final", True, False), 8))
brk.case("исход не угадан -> 0", lambda: eq(bonus("Final", False, False), 0))


# OTS-21: плей-офф — исход (кто прошёл) считается по выбору advance, а не по счёту.
teams_eq = server._teams_eq
winner_from_score = server._playoff_winner_from_score
pp = server._playoff_match_points  # -> (base_total, advance_ok, exact, player, bonus)
full = lambda *a: (lambda r: r[0] + r[4])(pp(*a))  # полные очки = база + бонус

po = suite("Плей-офф: исход = кто прошёл (_playoff_match_points, OTS-21)")
# сопоставление команд
po.case("teams_eq игнорит регистр/пробелы", lambda: ok(teams_eq("Дом", "  дом ")))
po.case("teams_eq разные = нет", lambda: ok(not teams_eq("Дом", "Гости")))
po.case("winner_from_score решающий", lambda: eq(winner_from_score("Дом", "Гости", 2, 0), "Дом"))
po.case("winner_from_score ничья -> '' (нужен админ)", lambda: eq(winner_from_score("Дом", "Гости", 1, 1), ""))
# групповой этап — падаем в старую механику (исход по счёту), бонус 0
po.case("группа: исход по счёту, бонус 0",
        lambda: eq(pp("1", "0", "X", "Дом", "2", "0", "Y", "Дом", "Group A"), (1, True, False, False, 0)))
# плей-офф: проход верный, счёт мимо
po.case("R32 проход верный, счёт мимо -> 1+1=2",
        lambda: eq(full("1", "0", "X", "Дом", "2", "0", "Y", "Дом", "Round of 32"), 2))
# точный счёт + проход
po.case("R16 точный + проход -> 3+(1+1)=5",
        lambda: eq(full("2", "0", "X", "Дом", "2", "0", "Y", "Дом", "Round of 16"), 5))
po.case("Финал точный + проход -> 3+(8+4)=15",
        lambda: eq(full("2", "1", "X", "Дом", "2", "1", "Y", "Дом", "Final"), 15))
# независимость: точный счёт, но проход выбран неверно -> только счёт + точный-бонус
po.case("R16 точный счёт, проход НЕверный -> 3+точный(1)=4 (исход 0)",
        lambda: eq(full("2", "0", "X", "Гости", "2", "0", "Y", "Дом", "Round of 16"), 4))
po.case("R16 точный счёт, проход НЕверный: advance_ok=False",
        lambda: eq(pp("2", "0", "X", "Гости", "2", "0", "Y", "Дом", "Round of 16"), (3, False, True, False, 1)))
# ничья -> пенальти: счёт без пенальти точный, проход по вердикту админа
po.case("QF ничья 1:1, точный + проход верный -> 3+(2+1)=6",
        lambda: eq(full("1", "1", "X", "Дом", "1", "1", "Y", "Дом", "Quarter-final"), 6))
po.case("QF ничья 1:1, точный есть, проход НЕверный -> 3+точный(1)=4",
        lambda: eq(full("1", "1", "X", "Гости", "1", "1", "Y", "Дом", "Quarter-final"), 4))
po.case("всё мимо -> 0",
        lambda: eq(full("0", "3", "X", "Гости", "2", "0", "Y", "Дом", "Quarter-final"), 0))


if __name__ == "__main__":
    main(points, edge, players, nrm, ko, brk, po)
