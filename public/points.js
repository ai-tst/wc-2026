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
    };
  }
  return adminEntry ?? null;
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
// The Final/champion stays as the existing "winner" outright (+8), so F earns no
// bracket bonus here — no double counting.
export const BRACKET_BONUS = {
  R32: { outcome: 1, player: 0 },
  R16: { outcome: 2, player: 1 },
  QF:  { outcome: 4, player: 1 },
  SF:  { outcome: 8, player: 2 },
};

export function calculateBracketBonus(user) {
  let total = 0;
  for (const match of activeMatches) {
    const tier = BRACKET_BONUS[classifyKnockoutRound(match.group)];
    if (!tier) continue;
    const pts = calculatePointsForMatch(user.matches?.[match.id], resolveActualResult(match));
    if (pts.outcomeCorrect)    total += tier.outcome;
    if (pts.bestPlayerCorrect) total += tier.player;
  }
  return total;
}

export function getUserTotalPoints(user) {
  let total = 0;
  for (const match of activeMatches) {
    const pred = user.matches?.[match.id];
    const actual = resolveActualResult(match);
    total += calculatePointsForMatch(pred, actual).total;
  }
  total += calculateOutrightsPoints(user.outrights, state.actualOutrights);
  total += calculateBracketBonus(user);
  total += user.bonusPoints || 0;
  return total;
}
