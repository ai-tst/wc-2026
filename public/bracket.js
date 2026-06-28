import { $, escapeHtml } from "./utils.js";
import { activeMatches, currentUser } from "./store.js";
import { withFlag } from "./matches.js";
import {
  classifyKnockoutRound, STAGE_POINTS,
  resolveActualResult, matchPointsFor, calculateBracketBonus,
} from "./points.js";

const teamsEq = (a, b) => Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase();
function sideOf(match, teamName) {
  if (teamsEq(teamName, match.home)) return "home";
  if (teamsEq(teamName, match.away)) return "away";
  return null;
}

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

// OTS-21: исход в плей-офф — это явный выбор «кто пройдёт» (pred.advance), а не
// победитель по счёту. Ничьи в KO решаются пенальти, по счёту победителя не видно.
function predWinner(pred, match) {
  if (!pred) return null;
  if (pred.advance) return sideOf(match, pred.advance);
  // легаси-ставки без advance: добираем из счёта, если он решающий
  if (pred.home === "" || pred.away === "") return null;
  const h = Number(pred.home), a = Number(pred.away);
  if (Number.isNaN(h) || Number.isNaN(a) || h === a) return null;
  return h > a ? "home" : "away";
}
function actualWinner(actual, match) {
  if (actual?.winner) return sideOf(match, actual.winner);
  return null;
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
  const aw     = actualWinner(actual, match);
  const pred   = currentUser?.matches?.[match.id];
  const pw     = predWinner(pred, match);
  const round  = classifyKnockoutRound(match.group);
  const tier   = STAGE_POINTS[round];

  // did your outcome pick hit, and how many pts did the match earn?
  let badge = "";
  if (pred && (pred.advance || (pred.home !== "" && pred.away !== ""))) {
    if (ended && aw) {
      const ptsObj = matchPointsFor(pred, match);
      const ok = ptsObj.outcomeCorrect;
      const gained = ptsObj.total;
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
    const t = STAGE_POINTS[c.key];
    const bonusChip = `<span class="bk-bonus${c.key === "F" ? " bk-bonus--champ" : ""}" title="очки за матч: исход +${t.outcome} · точный счёт +${t.exact} · игрок +${t.player}">+${t.outcome}·+${t.exact}·+${t.player}</span>`;
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
    ? `<p class="bk-hint">Плей-офф ещё не начался — висит скелет. Команды и счёт подставятся автоматически, как только матчи появятся в расписании. Ставки на счёт делаешь в «Матчах», очки за плей-офф капают сюда.</p>`
    : `<p class="bk-hint">Зелёным — кто прошёл / твой угаданный исход. <span class="bk-badge bk-badge--pick">ТЫ</span> — твой пик ждёт результата. Точный счёт ставишь в «Матчах». Чем глубже раунд — тем дороже матч, но ранние раунды берут массой матчей, так что забивать на 1/16 — себе дороже.</p>`;

  root.innerHTML = `
    <div class="bk-top">
      <div class="bk-legend">
        <span><b>1/16–1/8</b> исход +2 · точный +4 · игрок +3</span>
        <span><b>1/4–1/2</b> исход +3 · точный +5 · игрок +4</span>
        <span><b>финал</b> исход +4 · точный +6 · игрок +5</span>
      </div>
      <div class="bk-mybonus">Твои очки за плей-офф: <b>+${myBonus}</b></div>
    </div>
    ${hint}
    <div class="bracket-scroll">
      <div class="bracket">${cols}</div>
    </div>`;
}
