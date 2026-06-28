// Регресс-тесты на клиентскую логику начисления очков (public/points.js).
// Golden-значения ОБЯЗАНЫ совпадать с tests/test_scoring.py (серверный дубль).
//
// Запуск:  node tests/test_points.mjs

import {
  calculatePointsForMatch,
  calculateOutrightsPoints,
  classifyKnockoutRound,
  BRACKET_BONUS,
  matchPointsFor,
} from "../public/points.js";
import { state } from "../public/store.js";

let total = 0, passed = 0;
const G = "\x1b[32m", R = "\x1b[31m", D = "\x1b[2m", X = "\x1b[0m";

function eq(a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`ожидалось ${sb}, получено ${sa}`);
}
function ok(c) { if (!c) throw new Error("условие ложно"); }
function group(name) { console.log(`\n${D}── ${name} ──${X}`); }
function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`  ${G}✓${X} ${name}`); }
  catch (e) { console.log(`  ${R}✗ ${name}${X}\n    ${R}${e.message}${X}`); }
}

const P = (h, a, bp) => ({ home: h, away: a, bestPlayer: bp });
const A = (h, a, bp) => ({ home: h, away: a, bestPlayer: bp });
// удобный геттер только .total
const pts = (pred, actual) => calculatePointsForMatch(pred, actual).total;

group("Очки за матч (calculatePointsForMatch) — паритет с сервером");
test("точный счёт + игрок = 5", () => eq(pts(P("3", "1", "Messi"), A("3", "1", "Messi")), 5));
test("точный счёт без игрока = 3", () => eq(pts(P("2", "2", "X"), A("2", "2", "Y")), 3));
test("исход угадан, счёт мимо = 1", () => eq(pts(P("2", "0", "X"), A("5", "1", "Y")), 1));
test("исход + игрок = 3", () => eq(pts(P("2", "0", "Messi"), A("5", "1", "Messi")), 3));
test("только игрок (исход мимо) = 2", () => eq(pts(P("0", "2", "Messi"), A("3", "1", "Messi")), 2));
test("всё мимо = 0", () => eq(pts(P("0", "2", "X"), A("3", "1", "Y")), 0));
test("точная ничья 0:0 = 3", () => eq(pts(P("0", "0", "X"), A("0", "0", "Y")), 3));
test("ничья vs победа = 0", () => eq(pts(P("1", "1", "X"), A("2", "1", "Y")), 0));

group("Очки за матч — крайние случаи ввода");
test("пустой прогноз = 0", () => eq(pts(P("", "", "X"), A("1", "0", "Y")), 0));
test("нет actual = 0", () => eq(pts(P("1", "0", "X"), null), 0));
test("нечисловой счёт = 0", () => eq(pts(P("a", "b", "X"), A("1", "0", "Y")), 0));
test("bestPlayer как массив (авто-детект, ничья рейтингов)",
  () => eq(pts(P("0", "1", "Mbappe"), A("2", "0", ["Messi", "Mbappe"])), 2));
test("диакритика в имени игрока", () => eq(pts(P("0", "1", "Mbappe"), A("2", "0", "Mbappé")), 2));

group("Игнорирование диакритики/сокращений");
test("J. Alvarez = Julian Alvarez", () => eq(pts(P("1", "0", "J. Alvarez"), A("1", "0", "Julian Alvarez")), 5));

group("Ауткрайты (calculateOutrightsPoints)");
const ao = { winner: "Аргентина", bestPlayer: "Messi", topScorer: "Mbappe", darkHorse: JSON.stringify(["Гана", "Чехия", "Катар"]) };
test("чемпион = +8", () => eq(calculateOutrightsPoints({ winner: "Аргентина", bestPlayer: "", topScorer: "", darkHorse: "" }, ao), 8));
test("лучший игрок = +8", () => eq(calculateOutrightsPoints({ winner: "", bestPlayer: "messi", topScorer: "", darkHorse: "" }, ao), 8));
test("бомбардир = +5", () => eq(calculateOutrightsPoints({ winner: "", bestPlayer: "", topScorer: "Mbappe", darkHorse: "" }, ao), 5));
test("тёмная лошадка +3 за каждую угаданную",
  () => eq(calculateOutrightsPoints({ winner: "", bestPlayer: "", topScorer: "", darkHorse: JSON.stringify(["Гана", "Чехия"]) }, ao), 6));
test("всё угадано = 8+8+5+9 = 30", () => eq(calculateOutrightsPoints(ao, ao), 30));
test("ничего не угадано = 0",
  () => eq(calculateOutrightsPoints({ winner: "Бразилия", bestPlayer: "X", topScorer: "Y", darkHorse: "" }, ao), 0));
test("пустые ауткрайты = 0", () => eq(calculateOutrightsPoints(null, ao), 0));

group("Раунды плей-офф (classifyKnockoutRound)");
test("Round of 32 -> R32", () => eq(classifyKnockoutRound("Round of 32"), "R32"));
test("Round of 16 -> R16", () => eq(classifyKnockoutRound("Round of 16"), "R16"));
test("Quarter-final -> QF", () => eq(classifyKnockoutRound("Quarter-final"), "QF"));
test("Semi-final -> SF (а не F)", () => eq(classifyKnockoutRound("Semi-final"), "SF"));
test("Final -> F", () => eq(classifyKnockoutRound("Final"), "F"));
test("групповой -> null", () => eq(classifyKnockoutRound("Group A"), null));

group("Плей-офф: исход = кто прошёл (matchPointsFor) — OTS-21 + коэффициенты OTS-20");
// status >= 8 => resolveActualResult берёт счёт из матча; home/away нужны для
// сопоставления выбора «кто пройдёт» (advance).
const m = (group, h, a, bp) => ({ id: 1, group, status: 8, homeScore: h, awayScore: a, home: "Дом", away: "Гости", autoBestPlayer: bp });
// прогноз с явным выбором прохода
const PP = (h, a, bp, adv) => ({ home: h, away: a, bestPlayer: bp, advance: adv });

test("R32 проход верный, счёт мимо: база 1 + бонус (исход +1) = 2",
  () => eq(matchPointsFor(PP("1", "0", "X", "Дом"), m("Round of 32", 2, 0, "Y")).total, 2));
test("R32 точный счёт + проход: база 3 + бонус (точный +2, заменяет исход) = 5",
  () => eq(matchPointsFor(PP("2", "0", "X", "Дом"), m("Round of 32", 2, 0, "Y")).total, 5));
test("R16 точный счёт + проход: база 3 + бонус (точный +2) = 5",
  () => eq(matchPointsFor(PP("2", "0", "X", "Дом"), m("Round of 16", 2, 0, "Y")).total, 5));
test("SF точный + игрок + проход: база 5 + бонус (точный +3, игрок +2) = 10",
  () => eq(matchPointsFor(PP("2", "1", "Messi", "Дом"), m("Semi-final", 2, 1, "Messi")).total, 10));
test("Финал точный счёт + проход: база 3 + бонус (точный +4) = 7",
  () => { ok(BRACKET_BONUS.F.outcome === 3 && BRACKET_BONUS.F.exact === 4 && BRACKET_BONUS.F.player === 3);
          eq(matchPointsFor(PP("2", "1", "X", "Дом"), m("Final", 2, 1, "Y")).total, 7); });
test("Финал проход без точного: база 1 + бонус (исход +3) = 4",
  () => eq(matchPointsFor(PP("3", "1", "X", "Дом"), m("Final", 2, 1, "Y")).total, 4));
test("R32 проход + игрок (счёт мимо): база 3 + бонус (исход +1, игрок +1) = 5",
  () => eq(matchPointsFor(PP("1", "0", "Messi", "Дом"), m("Round of 32", 2, 0, "Messi")).total, 5));

group("Плей-офф: счёт и проход независимы — OTS-21");
test("точный счёт, но проход выбран НЕверно → счёт + точный-бонус: R16 3+2=5",
  () => eq(matchPointsFor(PP("2", "0", "X", "Гости"), m("Round of 16", 2, 0, "Y")).total, 5));
test("проход верный, но счёт мимо → только исход: R16 база 1 + бонус (исход +1) = 2",
  () => eq(matchPointsFor(PP("1", "3", "X", "Дом"), m("Round of 16", 2, 0, "Y")).total, 2));
test("ничья 1:1 → пенальти; точный счёт + проход верный (вердикт админа): QF 3+точный(3)=6",
  () => { state.actualMatches = { 1: { winner: "Дом" } };
          eq(matchPointsFor(PP("1", "1", "X", "Дом"), m("Quarter-final", 1, 1, "Y")).total, 6);
          state.actualMatches = {}; });
test("ничья 1:1 → пенальти; точный счёт, проход НЕверный: точный всё равно QF 3+3=6",
  () => { state.actualMatches = { 1: { winner: "Дом" } };
          eq(matchPointsFor(PP("1", "1", "X", "Гости"), m("Quarter-final", 1, 1, "Y")).total, 6);
          state.actualMatches = {}; });
test("проигранный проход и счёт мимо = 0",
  () => eq(matchPointsFor(PP("0", "3", "X", "Гости"), m("Quarter-final", 2, 0, "Y")).total, 0));

const fail = total - passed;
console.log(`\n${fail ? R : G}${passed}/${total} прошло${X}`);
process.exit(fail ? 1 : 0);
