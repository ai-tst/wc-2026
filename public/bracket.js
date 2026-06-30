import { $, escapeHtml } from "./utils.js";
import { activeMatches, currentUser, roundExtra } from "./store.js";
import { withFlag } from "./matches.js";
import {
  classifyKnockoutRound, STAGE_POINTS,
  resolveActualResult, matchPointsFor, calculateBracketBonus,
} from "./points.js";

// OTS-54: на доске показываем ВЕСЬ текущий раунд, а не только матчи из фильтра.
// Мерджим полный набор раунда (roundExtra) к activeMatches, дедуп по id.
function bracketMatches() {
  const extra = (roundExtra?.complete && roundExtra.matches) || [];
  if (!extra.length) return activeMatches;
  const seen = new Set(activeMatches.map((m) => String(m.id)));
  const merged = activeMatches.slice();
  for (const m of extra) if (!seen.has(String(m.id))) merged.push(m);
  return merged;
}

const teamsEq = (a, b) => Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase();
function sideOf(match, teamName) {
  if (teamsEq(teamName, match.home)) return "home";
  if (teamsEq(teamName, match.away)) return "away";
  return null;
}

// ── Real WC-2026 bracket tree ─────────────────────────────────────────────────
// The API gives a FLAT fixture list (round in `match.group`), no tree linkage, so
// the SHAPE is the official FIFA bracket, hardcoded here, and real matches are
// slotted into their correct positions by group + group-stage finishing place.
// Источник дерева — официальная сетка ЧМ-2026 (матчи 73–104). Раньше матчи 1/16
// просто резались по дате в случайные ячейки — теперь каждый матч встаёт ровно на
// своё место по группам (как в настоящей сетке).

// Группы ЧМ-2026 (написания команд — как в фиде). Места (1–4) считаются вживую из
// результатов группового этапа, не захардкожены.
const GROUP_TEAMS = {
  A: ["Mexico", "South Africa", "South Korea", "Czechia"],
  B: ["Switzerland", "Canada", "Bosnia & Herzegovina", "Qatar"],
  C: ["Brazil", "Morocco", "Scotland", "Haiti"],
  D: ["USA", "Australia", "Paraguay", "Türkiye"],
  E: ["Germany", "Ivory Coast", "Ecuador", "Curaçao"],
  F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
  G: ["Belgium", "Egypt", "Iran", "New Zealand"],
  H: ["Spain", "Cape Verde Islands", "Uruguay", "Saudi Arabia"],
  I: ["France", "Norway", "Senegal", "Iraq"],
  J: ["Argentina", "Austria", "Algeria", "Jordan"],
  K: ["Colombia", "Portugal", "Congo DR", "Uzbekistan"],
  L: ["England", "Croatia", "Ghana", "Panama"],
};
const TEAM_ALIASES = { "czech republic": "czechia" }; // фид иногда шлёт оба написания
function normTeam(name) {
  const n = (name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return TEAM_ALIASES[n] || n;
}
const TEAM_GROUP = {};
for (const [g, ts] of Object.entries(GROUP_TEAMS)) for (const t of ts) TEAM_GROUP[normTeam(t)] = g;

// Round of 32 — официальные слоты (номер матча → пара участников по группам).
// ["1","E"] = победитель E, ["2","C"] = второе место C, ["3","*"] = одна из лучших
// третьих команд (её конкретная группа задаётся таблицей Annex C, нам не важна —
// слот опознаём по стороне-победителю группы).
const R32_SLOTS = {
  73: [["2", "A"], ["2", "B"]],
  74: [["1", "E"], ["3", "*"]],
  75: [["1", "F"], ["2", "C"]],
  76: [["1", "C"], ["2", "F"]],
  77: [["1", "I"], ["3", "*"]],
  78: [["2", "E"], ["2", "I"]],
  79: [["1", "A"], ["3", "*"]],
  80: [["1", "L"], ["3", "*"]],
  81: [["1", "D"], ["3", "*"]],
  82: [["1", "G"], ["3", "*"]],
  83: [["2", "K"], ["2", "L"]],
  84: [["1", "H"], ["2", "J"]],
  85: [["1", "B"], ["3", "*"]],
  86: [["1", "J"], ["2", "H"]],
  87: [["1", "K"], ["3", "*"]],
  88: [["2", "D"], ["2", "G"]],
};
// (поз+группа) → слот R32 для победителей/вторых мест (третьи разрешаются по факту).
const POS_SLOT = {};
for (const [id, descs] of Object.entries(R32_SLOTS))
  for (const [p, g] of descs) if (p !== "3") POS_SLOT[p + g] = Number(id);

// дерево: слот → родительский слот следующего раунда
const PARENT = {
  74: 89, 77: 89, 73: 90, 75: 90, 76: 91, 78: 91, 79: 92, 80: 92,
  83: 93, 84: 93, 81: 94, 82: 94, 86: 95, 88: 95, 85: 96, 87: 96,
  89: 97, 90: 97, 93: 98, 94: 98, 91: 99, 92: 99, 95: 100, 96: 100,
  97: 101, 98: 101, 99: 102, 100: 102, 101: 104, 102: 104,
};
function roundOfSlot(id) {
  if (id <= 88) return "R32";
  if (id <= 96) return "R16";
  if (id <= 100) return "QF";
  if (id <= 102) return "SF";
  return "F";
}

const ROUND_META = {
  R32: { label: "1/16", full: "Round of 32" },
  R16: { label: "1/8",  full: "Round of 16" },
  QF:  { label: "1/4",  full: "Quarter-finals" },
  SF:  { label: "1/2",  full: "Semi-finals" },
  F:   { label: "Финал", full: "Final" },
};
// колонки слева→направо; slots — id ячеек сверху вниз (классическая зеркальная сетка)
const BRACKET_COLUMNS = [
  { key: "R32", side: "L", slots: [74, 77, 73, 75, 83, 84, 81, 82] },
  { key: "R16", side: "L", slots: [89, 90, 93, 94] },
  { key: "QF",  side: "L", slots: [97, 98] },
  { key: "SF",  side: "L", slots: [101] },
  { key: "F",   side: "C", slots: [104] },
  { key: "SF",  side: "R", slots: [102] },
  { key: "QF",  side: "R", slots: [99, 100] },
  { key: "R16", side: "R", slots: [91, 92, 95, 96] },
  { key: "R32", side: "R", slots: [76, 78, 79, 80, 86, 88, 85, 87] },
];

// ── Standings → finishing place (1–4) per team, computed live from the feed ────
function groupPositions() {
  const tbl = {}; // norm → {g, pts, gf, ga}
  const ensure = (name) => {
    const k = normTeam(name);
    if (!tbl[k]) tbl[k] = { g: TEAM_GROUP[k] || null, pts: 0, gf: 0, ga: 0 };
    return tbl[k];
  };
  for (const m of activeMatches) {
    if (!String(m.group || "").toLowerCase().startsWith("group")) continue;
    const r = resolveActualResult(m);
    if (!r || r.home === "" || r.away === "" || r.home == null || r.away == null) continue;
    const hs = Number(r.home), as = Number(r.away);
    if (Number.isNaN(hs) || Number.isNaN(as)) continue;
    const H = ensure(m.home), A = ensure(m.away);
    if (!H.g || !A.g) continue;
    H.gf += hs; H.ga += as; A.gf += as; A.ga += hs;
    if (hs > as) H.pts += 3; else if (as > hs) A.pts += 3; else { H.pts += 1; A.pts += 1; }
  }
  const pos = {};
  for (const g of Object.keys(GROUP_TEAMS)) {
    const members = GROUP_TEAMS[g].map(normTeam).filter((k) => tbl[k]);
    // FIFA-порядок: очки → разница → забитые (дальше head-to-head — на наших данных
    // не требуется, верифицировано против официальной таблицы)
    members.sort((a, b) => {
      const x = tbl[a], y = tbl[b];
      return (y.pts - x.pts) || ((y.gf - y.ga) - (x.gf - x.ga)) || (y.gf - x.gf);
    });
    members.forEach((k, i) => { pos[k] = i + 1; });
  }
  return pos;
}

function teamDesc(name, pos) {
  const k = normTeam(name);
  return { p: String(pos[k] || 0), g: TEAM_GROUP[k] || "?" };
}
function descMatch(slotDesc, td) {
  const [p, g] = slotDesc;
  if (td.p !== p) return false;
  return p === "3" ? true : td.g === g;
}
function r32SlotFor(match, pos) {
  const d1 = teamDesc(match.home, pos), d2 = teamDesc(match.away, pos);
  for (const [id, [s1, s2]] of Object.entries(R32_SLOTS)) {
    if ((descMatch(s1, d1) && descMatch(s2, d2)) || (descMatch(s1, d2) && descMatch(s2, d1)))
      return Number(id);
  }
  return null;
}
function originR32Slot(name, pos, teamSlot) {
  const k = normTeam(name);
  const p = pos[k], g = TEAM_GROUP[k];
  if ((p === 1 || p === 2) && POS_SLOT[String(p) + g]) return POS_SLOT[String(p) + g];
  return teamSlot.has(k) ? teamSlot.get(k) : null; // третьи места — по факту из R32
}

// matchId → slotId для всех сыгранных/назначенных матчей плей-офф
function buildSlotAssignment(pos) {
  const ko = bracketMatches().filter((m) => classifyKnockoutRound(m.group));
  const matchSlot = new Map();
  const teamSlot = new Map();
  // сначала R32 — он даёт привязку команда→слот (нужно для третьих мест дальше)
  for (const m of ko) {
    if (classifyKnockoutRound(m.group) !== "R32") continue;
    const s = r32SlotFor(m, pos);
    if (s) {
      matchSlot.set(m.id, s);
      teamSlot.set(normTeam(m.home), s);
      teamSlot.set(normTeam(m.away), s);
    }
  }
  // глубже — поднимаемся по дереву от слота R32 любой из команд
  for (const m of ko) {
    const round = classifyKnockoutRound(m.group);
    if (round === "R32") continue;
    for (const name of [m.home, m.away]) {
      if (!name) continue;
      let s = originR32Slot(name, pos, teamSlot);
      if (s == null) continue;
      while (roundOfSlot(s) !== round && PARENT[s] != null) s = PARENT[s];
      if (roundOfSlot(s) === round) { matchSlot.set(m.id, s); break; }
    }
  }
  return matchSlot;
}

// OTS-21: исход в плей-офф — это явный выбор «кто пройдёт» (pred.advance), а не
// победитель по счёту. Ничьи в KO решаются пенальти, по счёту победителя не видно.
function predWinner(pred, match) {
  if (!pred) return null;
  if (pred.advance) return sideOf(match, pred.advance);
  if (pred.home === "" || pred.away === "") return null;
  const h = Number(pred.home), a = Number(pred.away);
  if (Number.isNaN(h) || Number.isNaN(a) || h === a) return null;
  return h > a ? "home" : "away";
}
function actualWinner(actual, match) {
  if (actual?.winner) return sideOf(match, actual.winner);
  return null;
}

// подпись пустого слота R32 по группам: «E1», «C2», «3-е»
function slotLabel(desc) {
  const [p, g] = desc;
  return p === "3" ? "3-е" : `${g}${p}`;
}

// one match cell (or an empty skeleton slot showing what feeds it)
function bkMatch(match, slotId) {
  if (!match) {
    const descs = R32_SLOTS[slotId];
    if (descs) {
      return `<div class="bk-match bk-match--empty">
        <div class="bk-team"><span class="bk-slot">${escapeHtml(slotLabel(descs[0]))}</span></div>
        <div class="bk-team"><span class="bk-slot">${escapeHtml(slotLabel(descs[1]))}</span></div>
      </div>`;
    }
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

  // OTS-47: серия пенальти — счёт серии в скобках у каждой команды (1 (3) — 1 (4)).
  const hasPen = ended && actual.penalties === "yes" && actual.penHome != null && actual.penHome !== "";
  const penFor = (sideKey) => hasPen
    ? ` <span class="bk-pen">(${escapeHtml(String(sideKey === "home" ? actual.penHome : actual.penAway))})</span>`
    : "";
  const row = (sideKey, name) => {
    const isWinner = ended && aw === sideKey;
    const isMyPick = pw === sideKey;
    return `<div class="bk-team${isWinner ? " bk-team--win" : ""}${isMyPick ? " bk-team--pick" : ""}">
      ${name ? withFlag(name) : '<span class="bk-q">?</span>'}
      <span class="bk-score">${ended ? escapeHtml(String(sideKey === "home" ? actual.home : actual.away)) : ""}${penFor(sideKey)}</span>
    </div>`;
  };

  return `<div class="bk-match" data-id="${escapeHtml(String(match.id))}">
    ${badge}
    ${row("home", match.home)}
    ${row("away", match.away)}
  </div>`;
}

export function renderBracket() {
  const root = $("bracket-content");
  if (!root) return;

  const allMatches = bracketMatches();
  const koCount = allMatches.filter((m) => classifyKnockoutRound(m.group)).length;
  const myBonus = currentUser ? calculateBracketBonus(currentUser) : 0;

  const pos = groupPositions();
  const matchSlot = buildSlotAssignment(pos);
  const slotToMatch = new Map();
  for (const m of allMatches) {
    const s = matchSlot.get(m.id);
    if (s != null) slotToMatch.set(s, m);
  }

  const cols = BRACKET_COLUMNS.map((c) => {
    const meta = ROUND_META[c.key];
    const t = STAGE_POINTS[c.key];
    // компактные «плюсики» под подписью стадии (исход·точный·игрок)
    const bonusChip = `<span class="bk-bonus${c.key === "F" ? " bk-bonus--champ" : ""}" title="очки за матч: исход +${t.outcome} · точный счёт +${t.exact} · игрок +${t.player}">+${t.outcome}·+${t.exact}·+${t.player}</span>`;
    const cells = c.slots.map((slotId) => bkMatch(slotToMatch.get(slotId) || null, slotId)).join("");
    return `<div class="bk-col bk-col--${c.key.toLowerCase()} bk-col--${c.side.toLowerCase()}">
      <div class="bk-col-head">
        <span class="bk-col-title">${escapeHtml(meta.label)}</span>
        ${bonusChip}
      </div>
      <div class="bk-col-body">
        ${cells}
      </div>
    </div>`;
  }).join("");

  const hint = koCount === 0
    ? `<p class="bk-hint">Плей-офф ещё не начался — висит скелет реальной сетки ЧМ-2026. Команды и счёт подставятся на свои места автоматически.</p>`
    : "";

  root.innerHTML = `
    <div class="bk-top">
      <div class="bk-mybonus">Твои очки за плей-офф: <b>+${myBonus}</b></div>
    </div>
    ${hint}
    <div class="bracket-scroll">
      <div class="bracket">${cols}</div>
    </div>`;
}
