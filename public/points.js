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

  let total = 0;
  if (exactScore) total += 3;
  else if (outcomeCorrect) total += 1;
  if (bestPlayerCorrect) total += 2;

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

// Escalating bracket bonus, ADDED on top of normal match points (исход +1 /
// точный +3 / игрок +2 still apply to playoff matches). Deeper round = more.
//
// Схема честных коэффициентов плей-офф (решение CEO, OTS-20): бонус СВЕРХУ
// базовых очков, отдельно за ИСХОД / ТОЧНЫЙ СЧЁТ / ИГРОКА, растёт к финалу.
// Семантика как в базовых очках: точный счёт ЗАМЕНЯЕТ исход (не суммируется с
// ним), игрок начисляется отдельно. Т.е. бонус = (точный ? exact : исход ?
// outcome : 0) + (игрок ? player : 0).
export const BRACKET_BONUS = {
  R32: { outcome: 1, exact: 2, player: 1 },
  R16: { outcome: 1, exact: 2, player: 1 },
  QF:  { outcome: 2, exact: 3, player: 2 },
  SF:  { outcome: 2, exact: 3, player: 2 },
  F:   { outcome: 3, exact: 4, player: 3 },
};

export function calculateBracketBonus(user) {
  let total = 0;
  for (const match of activeMatches) {
    total += matchPointsFor(user.matches?.[match.id], match).bonus;
  }
  return total;
}

// Points a single match is worth to a prediction = base (исход/точный/игрок) PLUS
// the escalating playoff bonus for knockout rounds. `total` already includes the
// bonus, so result cards/badges that read `.total` show the full earned points.
//
// OTS-21: в плей-офф «исход» — это отдельное предсказание «кто пройдёт дальше»
// (pred.advance), а НЕ победитель по счёту. Точный счёт по-прежнему считается без
// серии пенальти. Эти два вопроса независимы: можно угадать счёт и промахнуться в
// проходе (ничья → пенальти) и наоборот.
function teamsEq(a, b) {
  return Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function matchPointsFor(pred, match) {
  const actual = resolveActualResult(match);
  const base = calculatePointsForMatch(pred, actual);
  const tier = BRACKET_BONUS[classifyKnockoutRound(match.group)];
  if (!tier) {
    // групповой этап — исход по счёту, как раньше
    return { ...base, bonus: 0, total: base.total };
  }
  // плей-офф: исход = угадан ли прошедший дальше
  const advanceCorrect = teamsEq(pred?.advance, actual?.winner);
  const exact  = base.exactScore;
  const player = base.bestPlayerCorrect;
  const baseTotal = (exact ? 3 : advanceCorrect ? 1 : 0) + (player ? 2 : 0);
  let bonus = 0;
  // Бонус сверху — как в базе: точный счёт заменяет исход, игрок отдельно.
  if (exact)               bonus += tier.exact;    // точный счёт
  else if (advanceCorrect) bonus += tier.outcome;  // угадал, кто прошёл
  if (player)              bonus += tier.player;   // лучший игрок матча
  return {
    outcomeCorrect: advanceCorrect,
    exactScore: exact,
    bestPlayerCorrect: player,
    bonus,
    total: baseTotal + bonus,
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
