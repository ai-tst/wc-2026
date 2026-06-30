import { state, activeMatches } from "./store.js";
import { parseDarkHorse } from "./utils.js";

function normalizePlayerStr(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function playerNamesMatch(a, b) {
  if (!a || !b) return false;
  const na = normalizePlayerStr(a);
  const nb = normalizePlayerStr(b);
  if (na === nb) return true;
  const pa = na.split(/\s+/);
  const pb = nb.split(/\s+/);
  // Last names must match
  if (pa[pa.length - 1] !== pb[pb.length - 1]) return false;
  const fa = pa[0], fb = pb[0];
  // Same first name + same last name, even if middle names differ
  // e.g. "Vinicius Junior" matches "Vinicius Jose Paixao de Oliveira Junior"
  if (fa === fb) return true;
  // Handle abbreviated first name: "J." matches "Julian"
  if (fa.endsWith(".") && fb.startsWith(fa.slice(0, -1))) return true;
  if (fb.endsWith(".") && fa.startsWith(fb.slice(0, -1))) return true;
  return false;
}

export function calculatePointsForMatch(pred, actual) {
  if (!pred || !actual) return { total: 0, outcomeCorrect: false, exactScore: false, bestPlayerCorrect: false };

  // Treat empty string as missing score (not as 0)
  if (pred.home === "" || pred.away === "") {
    return { total: 0, outcomeCorrect: false, exactScore: false, bestPlayerCorrect: false };
  }

  const homePred = Number(pred.home);
  const awayPred = Number(pred.away);
  const homeAct = Number(actual.home);
  const awayAct = Number(actual.away);

  if ([homePred, awayPred, homeAct, awayAct].some(Number.isNaN)) {
    return { total: 0, outcomeCorrect: false, exactScore: false, bestPlayerCorrect: false };
  }

  const predOutcome = homePred === awayPred ? "draw" : homePred > awayPred ? "home" : "away";
  const actOutcome = homeAct === awayAct ? "draw" : homeAct > awayAct ? "home" : "away";

  const outcomeCorrect = predOutcome === actOutcome;
  const exactScore = homePred === homeAct && awayPred === awayAct;
  // actual.bestPlayer can be a string (admin entry) or array (auto-detected, may have ties)
  const targets = Array.isArray(actual.bestPlayer) ? actual.bestPlayer : (actual.bestPlayer ? [actual.bestPlayer] : []);
  const bestPlayerCorrect = targets.length > 0 && targets.some(t => playerNamesMatch(pred.bestPlayer, t));

  // OTS-30: исход и точный счёт СУММИРУЮТСЯ (точный ⇒ исход тоже верен).
  const g = STAGE_POINTS.group;
  let total = 0;
  if (outcomeCorrect)    total += g.outcome;
  if (exactScore)        total += g.exact;
  if (bestPlayerCorrect) total += g.player;

  return { total, outcomeCorrect, exactScore, bestPlayerCorrect };
}

export function calculateOutrightsPoints(playerOutrights, actualOutrights) {
  if (!playerOutrights || !actualOutrights) return 0;
  const eq = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
  let total = 0;
  if (eq(playerOutrights.winner, actualOutrights.winner)) total += 8;
  if (eq(playerOutrights.bestPlayer, actualOutrights.bestPlayer)) total += 8;
  if (eq(playerOutrights.topScorer, actualOutrights.topScorer)) total += 5;
  // Dark horse: 3 picks, +3 per correct team
  const playerDH = parseDarkHorse(playerOutrights.darkHorse);
  const actualDH = parseDarkHorse(actualOutrights.darkHorse);
  for (const t of playerDH) {
    if (actualDH.some((a) => eq(a, t))) total += 3;
  }
  return total;
}

// OTS-21: кто прошёл дальше в плей-офф. Если счёт (без пенальти) решающий — победитель
// очевиден; при ничьей (ушли в пенальти) берём явный вердикт админа (actual.winner).
function resolveWinner(match, homeAct, awayAct, adminEntry) {
  if (adminEntry?.winner) return adminEntry.winner;
  const ah = Number(homeAct), aa = Number(awayAct);
  if (!Number.isNaN(ah) && !Number.isNaN(aa) && ah !== aa) {
    return ah > aa ? match.home : match.away;
  }
  return "";
}

// Returns the actual result for a match, preferring API-provided scores for ended matches.
// bestPlayer still comes from admin-entered data (no API source for it).
export function resolveActualResult(match) {
  const adminEntry = state.actualMatches?.[match.id];
  const s = Number(match.status);
  if (s >= 8 && match.homeScore != null && match.awayScore != null) {
    return {
      home: String(match.homeScore),
      away: String(match.awayScore),
      // admin override → auto-detected from API ratings → empty
      bestPlayer: adminEntry?.bestPlayer || match.autoBestPlayer || "",
      winner: resolveWinner(match, match.homeScore, match.awayScore, adminEntry),
      penalties: adminEntry?.penalties || "",
      // OTS-47: счёт серии пенальти (авто из API) — для отображения «пен X:Y»
      penHome: adminEntry?.penHome || "",
      penAway: adminEntry?.penAway || "",
    };
  }
  if (adminEntry) {
    return {
      ...adminEntry,
      winner: resolveWinner(match, adminEntry.home, adminEntry.away, adminEntry),
    };
  }
  return null;
}

// OTS-47: матч показываем как ФИНАЛЬНЫЙ результат только когда исход полностью
// определён. Провайдер sstats ставит status 8 ("Finished") лишь после основного +
// доп. времени + пенальти (доп. время — статус 6, серия пенальти — 7, оба держатся
// как live). НО апи не отдаёт счёт серии пенальти: при ничьей в осн.+доп. FT-счёт
// остаётся ничейным (напр. 1:1), и кто прошёл дальше — решает админ (OTS-21). Пока
// этого нет, «результат» неполон (счёт без прошедшего), поэтому не выводим его как
// финальный — матч висит в актуальных, ждёт исхода. Для группы / решающего счёта
// статуса 8 достаточно.
export function isMatchResultFinal(match) {
  if (Number(match.status) < 8) return false;             // ещё идёт (вкл. доп.время/пенальти)
  if (!classifyKnockoutRound(match.group)) return true;   // группа — счёт самодостаточен
  const h = Number(match.homeScore), a = Number(match.awayScore);
  if (Number.isFinite(h) && Number.isFinite(a) && h !== a) return true;  // решающий счёт → прошедший очевиден
  return Boolean(state.actualMatches?.[match.id]?.winner); // ничья → нужен явный исход (пенальти) от админа
}

// Фаза матча для UI: 'upcoming' | 'live' | 'ended'.
// OTS-47: «live» = матч ИДЁТ (status 3–7) ИЛИ отыгран, но исход ещё не финален
// (ничья плей-офф, ждём пенальти). «ended» только когда результат финален.
export function getMatchPhase(match) {
  const s = Number(match.status);
  if (!s || s <= 2) return "upcoming";
  if (!isMatchResultFinal(match)) return "live";
  return "ended";
}

// OTS-56: порядок «Матчи сёдня» — СНАЧАЛА идущие (live), затем предстоящие.
// ИНВАРИАНТ (его и проверяет tests/test_today_matches.mjs): любой идущий матч
// ВСЕГДА попадает в этот список и стоит выше upcoming. Раньше тут был только
// upcoming → идущий матч выпадал из UI; тест на это не ловил, потому что проверял
// лишь бэкенд-выдачу, а не то, что реально рендерится в «Матчи сёдня».
export function buildTodayMatches(matches) {
  const byTime = (a, b) => String(a.dateTimeRaw).localeCompare(String(b.dateTimeRaw));
  const live     = (matches || []).filter((m) => getMatchPhase(m) === "live").sort(byTime);
  const upcoming = (matches || []).filter((m) => getMatchPhase(m) === "upcoming").sort(byTime);
  return [...live, ...upcoming];
}

// ── Playoff bracket ───────────────────────────────────────────────────────────
// Knockout round detected from the match's `group` label (sstats `roundName`).
// Order matters: "quarter-final"/"semi-final" both contain "final", so those are
// checked before the bare "final". Real values seen live: "Round of 32".
export function classifyKnockoutRound(group) {
  const g = (group || "").toLowerCase();
  if (g.includes("round of 32") || g.includes("1/16")) return "R32";
  if (g.includes("round of 16") || g.includes("1/8"))  return "R16";
  if (g.includes("quarter")     || g.includes("1/4"))  return "QF";
  if (g.includes("semi")        || g.includes("1/2"))  return "SF";
  if (g.includes("final"))                             return "F";
  return null;
}

// OTS-30: плоские таблицы очков по этапам — БЕЗ эскалирующего бонуса (его убрали,
// слишком путал). Исход и точный счёт СУММИРУЮТСЯ (раньше точный заменял исход),
// игрок отдельно. Чем глубже раунд — тем дороже матч. Зеркало _STAGE_POINTS в
// server.py (golden-тесты сверяют значения).
export const STAGE_POINTS = {
  group: { outcome: 1, exact: 2, player: 2 },
  R32:   { outcome: 2, exact: 4, player: 3 },
  R16:   { outcome: 2, exact: 4, player: 3 },
  QF:    { outcome: 3, exact: 5, player: 4 },
  SF:    { outcome: 3, exact: 5, player: 4 },
  F:     { outcome: 4, exact: 6, player: 5 },
};

export function stagePoints(group) {
  return STAGE_POINTS[classifyKnockoutRound(group)] || STAGE_POINTS.group;
}

// Сумма очков игрока ТОЛЬКО за матчи плей-офф (для бэйджа на сетке). Раньше это
// был «бонус за сетку»; теперь бонуса нет — показываем реальные очки плей-офф.
export function calculateBracketBonus(user) {
  let total = 0;
  for (const match of activeMatches) {
    if (!classifyKnockoutRound(match.group)) continue;
    total += matchPointsFor(user.matches?.[match.id], match).total;
  }
  return total;
}

// Points a single match is worth to a prediction по плоской таблице этапа.
// `total` — полные очки матча (исход + точный счёт + игрок, всё суммируется).
//
// OTS-21/OTS-27: в плей-офф «исход» — это «кто пройдёт дальше». Берём явный пик
// pred.advance, а если его нет — выводим из предсказанного счёта (как в группе),
// чтобы игрок, заполнивший только счёт, получал очко за угаданный исход. Точный
// счёт считается по осн.+доп. без серии пенальти.
function teamsEq(a, b) {
  return Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// OTS-27: кого игрок назначил победителем плей-офф-матча. Источник истины — явный
// пик «кто пройдёт» (pred.advance); если его нет — выводим из предсказанного счёта
// (решающий счёт → победившая команда), ровно как исход в групповом этапе. Так
// игрок, заполнивший только счёт, не теряет очко за угаданный исход.
export function predictedAdvance(pred, match) {
  if (pred?.advance) return pred.advance;
  if (!pred || pred.home === "" || pred.away === "") return "";
  const h = Number(pred.home), a = Number(pred.away);
  if (Number.isNaN(h) || Number.isNaN(a)) return "";
  if (h > a) return match.home;
  if (a > h) return match.away;
  return ""; // предсказана ничья — победитель не выбран
}

export function matchPointsFor(pred, match) {
  const actual = resolveActualResult(match);
  const base = calculatePointsForMatch(pred, actual);
  const round = classifyKnockoutRound(match.group);
  const pts = STAGE_POINTS[round] || STAGE_POINTS.group;
  if (!round) {
    // групповой этап — calculatePointsForMatch уже посчитал по групповой таблице
    return { ...base, bonus: 0, total: base.total };
  }
  // плей-офф: исход = угадан ли прошедший дальше (пик advance или вывод из счёта);
  // точный счёт и исход суммируются, игрок отдельно.
  const advanceCorrect = teamsEq(predictedAdvance(pred, match), actual?.winner);
  const exact  = base.exactScore;
  const player = base.bestPlayerCorrect;
  const total = (advanceCorrect ? pts.outcome : 0) + (exact ? pts.exact : 0) + (player ? pts.player : 0);
  return {
    outcomeCorrect: advanceCorrect,
    exactScore: exact,
    bestPlayerCorrect: player,
    bonus: 0,
    total,
  };
}

export function getUserTotalPoints(user) {
  let total = 0;
  // matchPointsFor — единый источник правды по матчу: даёт базу + бонус плей-офф и
  // в плей-офф считает исход по «кто прошёл» (pred.advance), а не по счёту.
  for (const match of activeMatches) {
    total += matchPointsFor(user.matches?.[match.id], match).total;
  }
  total += calculateOutrightsPoints(user.outrights, state.actualOutrights);
  total += user.bonusPoints || 0;
  return total;
}

// Только очки за матчи плей-офф (база + бонус за раунд). Ауткрайты и групповой этап не учитываются.
export function getUserPlayoffPoints(user) {
  let total = 0;
  for (const match of activeMatches) {
    if (!classifyKnockoutRound(match.group)) continue;
    total += matchPointsFor(user.matches?.[match.id], match).total;
  }
  return total;
}

// Стартовал ли плей-офф? true, как только у хотя бы одного knockout-матча есть
// фактический результат. Пока false — показываем приятный пустой стейт вместо
// голого списка нулей.
export function playoffHasStarted() {
  return activeMatches.some(
    (m) => classifyKnockoutRound(m.group) && resolveActualResult(m)
  );
}
