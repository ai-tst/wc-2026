// Регресс-тест порядка/состава списка «Матчи сёдня» (public/points.js).
//
// Зачем отдельно от test_live.py: тот проверял лишь БЭКЕНД-выдачу /api/matches
// (матч есть в JSON), но НЕ то, что реально рендерится на главной. Из-за этого
// баг «идущий матч не виден в UI» тест не ловил. Здесь проверяем сам отбор для
// «Матчи сёдня»: идущий матч ОБЯЗАН быть в списке и стоять выше upcoming. Под
// старой логикой (visibleMatches = только upcoming) эти кейсы падают — то, что и
// нужно было поймать.
//
// Запуск:  node tests/test_today_matches.mjs

import { buildTodayMatches, getMatchPhase } from "../public/points.js";
import { state } from "../public/store.js";

let total = 0, passed = 0;
const G = "\x1b[32m", R = "\x1b[31m", D = "\x1b[2m", X = "\x1b[0m";
function eq(a, b) { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa !== sb) throw new Error(`ожидалось ${sb}, получено ${sa}`); }
function ok(c, m = "условие ложно") { if (!c) throw new Error(m); }
function group(name) { console.log(`\n${D}── ${name} ──${X}`); }
function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`  ${G}✓${X} ${name}`); }
  catch (e) { console.log(`  ${R}✗ ${name}${X}\n    ${R}${e.message}${X}`); }
}

// фабрика матча. t — kickoff (для сортировки/фазы по времени неважно, status решает).
const M = (id, status, t, extra = {}) => ({
  id, status,
  home: extra.home || "Home", away: extra.away || "Away",
  homeScore: extra.homeScore ?? null, awayScore: extra.awayScore ?? null,
  group: extra.group || "Group A",
  dateTimeRaw: t,
});
const ids = (list) => list.map((m) => m.id);

group("getMatchPhase — фазы по статусу");
test("status 2 → upcoming", () => eq(getMatchPhase(M("a", 2, "2026-06-30T20:00:00+03:00")), "upcoming"));
for (const s of [3, 4, 5, 6, 7]) {
  test(`status ${s} → live`, () => eq(getMatchPhase(M("a", s, "2026-06-30T20:00:00+03:00")), "live"));
}
test("status 8 (группа) → ended", () => eq(getMatchPhase(M("a", 8, "2026-06-30T20:00:00+03:00", { homeScore: 1, awayScore: 0 })), "ended"));

group("buildTodayMatches — все активные матчи по дате начала (инвариант OTS-56)");

test("РЕГРЕССИЯ OTS-55: единственный идущий матч ПРИСУТСТВУЕТ в списке", () => {
  // Под старым кодом (только upcoming) тут был бы пустой список — это и был баг.
  const list = buildTodayMatches([M("LIVE", 5, "2026-06-30T20:00:00+03:00")]);
  ok(ids(list).includes("LIVE"), "идущий матч пропал из «Матчи сёдня»");
});

test("ВСЕ активные матчи отсортированы строго по дате начала (kickoff)", () => {
  state.actualMatches = {};
  const list = buildTodayMatches([
    M("UP_LATE",  2, "2026-07-02T22:00:00+03:00"),                                            // upcoming, позже всех
    M("LIVE",     5, "2026-06-30T20:00:00+03:00"),                                            // идёт (стартовал в прошлом)
    M("UP_SOON",  2, "2026-07-01T19:00:00+03:00"),                                            // upcoming, скоро
    M("PEN",      8, "2026-06-30T18:00:00+03:00", { group: "Round of 32", homeScore: 1, awayScore: 1 }), // «ждём исход», стартовал раньше live
  ]);
  // отсортировано по dateTimeRaw: PEN(18:00) → LIVE(20:00) → UP_SOON(01.07) → UP_LATE(02.07)
  eq(ids(list), ["PEN", "LIVE", "UP_SOON", "UP_LATE"]);
});

test("ничто активное не теряется: live + ждём-исход + upcoming все в списке", () => {
  state.actualMatches = {};
  const list = buildTodayMatches([
    M("UP",   2, "2026-07-01T20:00:00+03:00"),
    M("LIVE", 5, "2026-06-30T20:00:00+03:00"),
    M("PEN",  8, "2026-06-30T18:00:00+03:00", { group: "Round of 32", homeScore: 2, awayScore: 2 }),
  ]);
  ok(ids(list).includes("UP") && ids(list).includes("LIVE") && ids(list).includes("PEN"));
});

test("завершённый матч НЕ попадает в «Матчи сёдня» (он в «Результатах»)", () => {
  const list = buildTodayMatches([
    M("DONE", 8, "2026-06-30T18:00:00+03:00", { homeScore: 2, awayScore: 1 }),
    M("LIVE", 5, "2026-06-30T20:00:00+03:00"),
    M("UP", 2, "2026-07-01T20:00:00+03:00"),
  ]);
  eq(ids(list), ["LIVE", "UP"]);
});

group("Краевые случаи остаются в списке (live-фаза)");
for (const [s, name] of [[4, "перерыв"], [6, "доп. время"], [7, "пенальти"]]) {
  test(`${name} (status ${s}) — в списке`, () => {
    ok(ids(buildTodayMatches([M("E", s, "2026-06-30T20:00:00+03:00")])).includes("E"));
  });
}
test("«ждём исход» (status 8, R32, ничья, исход не задан) — В СПИСКЕ (правка автора)", () => {
  state.actualMatches = {};   // исход админом не задан
  const m = M("PEN", 8, "2026-06-30T20:00:00+03:00", { group: "Round of 32", homeScore: 1, awayScore: 1 });
  eq(getMatchPhase(m), "live");
  ok(ids(buildTodayMatches([m])).includes("PEN"), "«ждём исход» потерялся из списка");
});
test("плей-офф ничья С исходом (winner задан) → ended, уходит из списка", () => {
  const m = M("PEN2", 8, "2026-06-30T20:00:00+03:00", { group: "Round of 32", homeScore: 1, awayScore: 1 });
  state.actualMatches = { PEN2: { winner: "Home" } };
  eq(getMatchPhase(m), "ended");
  ok(!ids(buildTodayMatches([m])).includes("PEN2"));
  state.actualMatches = {};
});

console.log(`\n${passed === total ? G : R}${passed}/${total} прошло${X}`);
process.exit(passed === total ? 0 : 1);
