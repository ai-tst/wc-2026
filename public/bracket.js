import { $, escapeHtml } from "./utils.js";
import { activeMatches, currentUser } from "./store.js";
import { withFlag } from "./matches.js";
import {
  classifyKnockoutRound, BRACKET_BONUS,
  resolveActualResult, calculatePointsForMatch, calculateBracketBonus,
} from "./points.js";

// ── Bracket skeleton ────────────────────────────────────────────────────────
// WC-2026: 32 teams → 1/16 → 1/8 → ¼ → ½ → Final. The API gives a flat fixture
// list (round in `match.group`), no tree linkage, so the SHAPE is hardcoded here
// and teams/results are slotted in from the feed. Rounds not yet seeded show as
// empty "?" cells (skeleton). Layout is mirrored (classic bracket): left half +
// centre final + right half.
const ROUND_META = {
  R32: { label: "1/16",  full: "Round of 32" },
  R16: { label: "1/8",   full: "Round of 16" },
  QF:  { label: "1/4",   full: "Quarter-finals" },
  SF:  { label: "1/2",   full: "Semi-finals" },
  F:   { label: "Финал", full: "Final" },
};
// columns left→right; `side` tells which slice of a round's matches to take
const COLUMNS = [
  { key: "R32", side: "L", n: 8 },
  { key: "R16", side: "L", n: 4 },
  { key: "QF",  side: "L", n: 2 },
  { key: "SF",  side: "L", n: 1 },
  { key: "F",   side: "C", n: 1 },
  { key: "SF",  side: "R", n: 1 },
  { key: "QF",  side: "R", n: 2 },
  { key: "R16", side: "R", n: 4 },
  { key: "R32", side: "R", n: 8 },
];

function matchesForRound(key) {
  return activeMatches
    .filter((m) => classifyKnockoutRound(m.group) === key)
    .sort((a, b) => String(a.dateTimeRaw).localeCompare(String(b.dateTimeRaw)) || String(a.id).localeCompare(String(b.id)));
}

// take the L (first) or R (second) half of a round's matches for a column of size n
function slice(all, side, n) {
  if (side === "C") return all.slice(0, n);
  const start = side === "L" ? 0 : Math.ceil(all.length / 2);
  return all.slice(start, start + n);
}

function predWinner(pred) {
  if (!pred || pred.home === "" || pred.away === "") return null;
  const h = Number(pred.home), a = Number(pred.away);
  if (Number.isNaN(h) || Number.isNaN(a) || h === a) return null; // draws don't exist in KO; ignore
  return h > a ? "home" : "away";
}
function actualWinner(actual) {
  if (!actual || actual.home === "" || actual.away === "") return null;
  const h = Number(actual.home), a = Number(actual.away);
  if (Number.isNaN(h) || Number.isNaN(a)) return null;
  if (h === a) return null; // KO ties decided on pens — API score may still differ; leave neutral
  return h > a ? "home" : "away";
}

// one match cell (or an empty skeleton slot)
function bkMatch(match) {
  if (!match) {
    return `<div class="bk-match bk-match--empty">
      <div class="bk-team"><span class="bk-q">?</span></div>
      <div class="bk-team"><span class="bk-q">?</span></div>
    </div>`;
  }
  const actual = resolveActualResult(match);
  const ended  = actual && actual.home !== "" && actual.away !== "" && actual.home != null && actual.away != null;
  const aw     = actualWinner(actual);
  const pred   = currentUser?.matches?.[match.id];
  const pw     = predWinner(pred);
  const round  = classifyKnockoutRound(match.group);
  const tier   = BRACKET_BONUS[round];

  // did your outcome pick hit, and how many bonus pts did it earn?
  let badge = "";
  if (pred && (pred.home !== "" && pred.away !== "")) {
    if (ended && aw) {
      const ptsObj = calculatePointsForMatch(pred, actual);
      const ok = ptsObj.outcomeCorrect;
      let gained = 0;
      if (ok && tier) {
        gained += tier.outcome;
        if (ptsObj.exactScore) gained += tier.exact;
      }
      badge = ok
        ? `<span class="bk-badge bk-badge--ok">✓${gained ? " +" + gained : ""}</span>`
        : `<span class="bk-badge bk-badge--no">✗</span>`;
    } else {
      badge = `<span class="bk-badge bk-badge--pick">ТЫ</span>`;
    }
  }

  const row = (sideKey, name, score) => {
    const isWinner = ended && aw === sideKey;
    const isMyPick = pw === sideKey;
    return `<div class="bk-team${isWinner ? " bk-team--win" : ""}${isMyPick ? " bk-team--pick" : ""}">
      ${name ? withFlag(name) : '<span class="bk-q">?</span>'}
      <span class="bk-score">${ended ? escapeHtml(String(sideKey === "home" ? actual.home : actual.away)) : ""}</span>
    </div>`;
  };

  return `<div class="bk-match" data-id="${escapeHtml(String(match.id))}">
    ${badge}
    ${row("home", match.home, true)}
    ${row("away", match.away, true)}
  </div>`;
}

export function renderBracket() {
  const root = $("bracket-content");
  if (!root) return;

  // any knockout data at all yet?
  const koCount = activeMatches.filter((m) => classifyKnockoutRound(m.group)).length;

  const myBonus = currentUser ? calculateBracketBonus(currentUser) : 0;

  const cols = COLUMNS.map((c) => {
    const meta = ROUND_META[c.key];
    const all  = matchesForRound(c.key);
    const cells = slice(all, c.side, c.n);
    const padded = Array.from({ length: c.n }, (_, i) => cells[i] || null);
    const t = BRACKET_BONUS[c.key];
    const bonusChip = `<span class="bk-bonus${c.key === "F" ? " bk-bonus--champ" : ""}">исход +${t.outcome}${t.exact ? " · точный +" + t.exact : ""}</span>`;
    // header only on the first time we show a round label per side (keep all for clarity)
    return `<div class="bk-col bk-col--${c.key.toLowerCase()} bk-col--${c.side.toLowerCase()}">
      <div class="bk-col-head">
        <span class="bk-col-title">${escapeHtml(meta.label)}</span>
        ${bonusChip}
      </div>
      <div class="bk-col-body">
        ${padded.map(bkMatch).join("")}
      </div>
    </div>`;
  }).join("");

  const hint = koCount === 0
    ? `<p class="bk-hint">Плей-офф ещё не начался — висит скелет. Команды и счёт подставятся автоматически, как только матчи появятся в расписании. Ставки на счёт делаешь в «Матчах», бонус за глубину капает сюда.</p>`
    : `<p class="bk-hint">Зелёным — кто прошёл / твой угаданный исход. <span class="bk-badge bk-badge--pick">ТЫ</span> — твой пик ждёт результата. Точный счёт ставишь в «Матчах». Чем глубже раунд — тем жирнее бонус, но ранние раунды берут массой матчей, так что забивать на 1/16 — себе дороже.</p>`;

  root.innerHTML = `
    <div class="bk-top">
      <div class="bk-legend">
        <span><b>1/16</b> исход +1</span>
        <span><b>1/8</b> +1 · точный +1</span>
        <span><b>1/4</b> +2 · точный +1</span>
        <span><b>1/2</b> +4 · точный +2</span>
        <span><b>финал</b> +8 · точный +4</span>
      </div>
      <div class="bk-mybonus">Твой бонус за сетку: <b>+${myBonus}</b></div>
    </div>
    ${hint}
    <div class="bracket-scroll">
      <div class="bracket">${cols}</div>
    </div>`;
}
