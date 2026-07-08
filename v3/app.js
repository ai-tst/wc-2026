// ============================================================================
// ОТСОС · дизайн v3 (OTS-82 / доводка OTS-87) — off-neon премиум, за гейтом Тимы.
// Переиспользует РЕАЛЬНЫЙ дата-слой v2 (api-client / api / store / points),
// рендерит по-новому. Механика только реальная (points.js — единый источник).
// OTS-87: мобильная таблица-арена · Месси async в карточке · казик-аттракцион ·
// сетка-дерево · фильтр по стране + сорт убыв. · без профиля · реакции · шэр.
// Старый дизайн не тронут: это отдельная страница /v3, свой DOM и стили.
// ============================================================================
import { apiMe, apiGetPredictions, apiGetLeaderboard, apiSavePrediction, apiMatchHint } from "../api-client.js";
import { fetchMatchesFromSportDb, fetchUpcomingMatches, getTeamPlayers } from "../api.js";
import { state, updateStateFromServer, setActiveMatches, activeMatches, setCurrentUser, currentUser } from "../store.js";
import { getMatchPhase, classifyKnockoutRound, matchPointsFor, resolveActualResult, predictedAdvance, stagePoints } from "../points.js";
import { getUserTotalPoints } from "../points.js";
import { escapeHtml } from "../utils.js";
import { flagImg, flagCode } from "./flags.js";
import { setupCasino, toggleCasino as casinoToggle, isCasinoMode, runScoreSlot } from "./casino.js";
import { renderBracketTree } from "./bracket.js";
import { openShareCard } from "../share-card.js";

const $ = (id) => document.getElementById(id);
const esc = escapeHtml;

let FUTURE = [];          // будущие матчи вне сегодняшнего горизонта
let degraded = false;     // провайдер лёг → данные неполные
const drafts = new Map(); // matchId → {h,a,player,advance,placed,changed}
let curFilter = "today", curSub = null, curCountry = null;

// ── helpers ────────────────────────────────────────────────────────────────
const KO_RU = { R32: "1/16 финала", R16: "1/8 финала", QF: "1/4 финала", SF: "1/2 финала", F: "Финал" };
function stageLabel(m) {
  const ko = classifyKnockoutRound(m.group);
  if (ko) return KO_RU[ko];
  const g = m.group || "";
  const md = g.match(/Group Stage\s*-?\s*(\d+)/i);
  if (md) return `Групповой этап · ${md[1]} тур`;
  const gl = g.match(/^Group\s+([A-Z])\b/i);
  if (gl) return `Группа ${gl[1].toUpperCase()}`;
  return esc(g.replace(/^Group\b/i, "Группа").replace(/\bGroup\b/gi, "Группа"));
}
function isKO(m) { return Boolean(classifyKnockoutRound(m.group)); }

function mskParts(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d)) return null;
  const t = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(d);
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short" }).format(d);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return { t, day, ymd };
}
function mskTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function timeText(m) {
  const p = mskParts(m.dateTimeRaw);
  if (!p) return esc(m.time || "");
  const today = mskTodayYmd();
  if (p.ymd === today) return `Сегодня ${p.t} МСК`;
  return `${p.day}, ${p.t} МСК`;
}

const AV_COLORS = ["#2ee27a", "#a9a0ff", "#ffcb45", "#7aa2ff", "#ff8fa3", "#5ad1c4"];
function avColor(nick) {
  let h = 0; for (const c of (nick || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
function initials(nick) {
  const s = (nick || "?").trim();
  return s.length <= 2 ? s.toUpperCase() : s.slice(0, 2).toUpperCase();
}
function isMe(nick) { return currentUser && (nick || "").toLowerCase() === (currentUser.nickname || "").toLowerCase(); }

// ── toast ───────────────────────────────────────────────────────────────────
let toastT;
function toast(msg) {
  const t = $("toast"); if (!t) return;
  t.innerHTML = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600);
}

// ── points / leaderboard helpers ─────────────────────────────────────────────
function sortedUsers() {
  return [...(state.users || [])]
    .filter((u) => u.onboardingComplete !== false)
    .map((u) => ({ u, pts: getUserTotalPoints(u) }))
    .sort((a, b) => b.pts - a.pts || (a.u.nickname || "").localeCompare(b.u.nickname || ""));
}
function myStanding() {
  const list = sortedUsers();
  const idx = list.findIndex((x) => isMe(x.u.nickname));
  if (idx < 0) return { rank: null, pts: 0 };
  return { rank: idx + 1, pts: list[idx].pts };
}

// «стрелки за тур»: сравниваем текущий ранг с рангом ДО последнего завершённого
// игрового дня (МСК). Дельта очков за тот день вычитается у каждого — так видно,
// кто взлетел/упал на последних результатах. Без исторических снапшотов на бэке.
function lastFinishedDay() {
  let best = null;
  for (const m of feedPool()) {
    if (getMatchPhase(m) !== "ended") continue;
    const p = mskParts(m.dateTimeRaw); if (!p) continue;
    if (!best || p.ymd > best) best = p.ymd;
  }
  return best;
}
function movementMap() {
  const day = lastFinishedDay();
  const now = sortedUsers();                       // ранг сейчас
  if (!day) { const mv = {}; now.forEach((x) => { mv[x.u.nickname] = 0; }); return { mv, now }; }
  const dayMatches = feedPool().filter((m) => getMatchPhase(m) === "ended" && mskParts(m.dateTimeRaw)?.ymd === day);
  const prev = now.map((x) => {
    let d = 0;
    for (const m of dayMatches) { const pr = x.u.matches?.[m.id]; if (pr) d += matchPointsFor(pr, m).total; }
    return { nick: x.u.nickname, pts: x.pts - d };
  }).sort((a, b) => b.pts - a.pts || a.nick.localeCompare(b.nick));
  const prevRank = {}; prev.forEach((x, i) => { prevRank[x.nick] = i + 1; });
  const mv = {};
  now.forEach((x, i) => { mv[x.u.nickname] = (prevRank[x.u.nickname] ?? (i + 1)) - (i + 1); });
  return { mv, now };
}

// ── reactions (лёгкий соц-слой, клиентский, для друзей) ──────────────────────
const REACT_KEY = "otsos_v3_reactions";
const REACTIONS = ["🔥", "🤡", "💀"];
let reactStore = {};
try { reactStore = JSON.parse(localStorage.getItem(REACT_KEY) || "{}"); } catch { reactStore = {}; }
function reactSave() { try { localStorage.setItem(REACT_KEY, JSON.stringify(reactStore)); } catch { /* quota */ } }
function reactKey(mid, nick) { return `${mid}|${(nick || "").toLowerCase()}`; }
function reactCluster(mid, nick) {
  const sel = reactStore[reactKey(mid, nick)] || "";
  return `<span class="react" data-react="${esc(reactKey(mid, nick))}">` +
    REACTIONS.map((e) => `<button class="rx${sel === e ? " on" : ""}" data-rx="${e}" title="реакция">${e}</button>`).join("") + `</span>`;
}
function wireReactions(el) {
  el.querySelectorAll("[data-react]").forEach((cl) => {
    const key = cl.dataset.react;
    cl.querySelectorAll("[data-rx]").forEach((b) => b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const e = b.dataset.rx;
      if (reactStore[key] === e) delete reactStore[key]; else reactStore[key] = e;
      reactSave();
      cl.querySelectorAll("[data-rx]").forEach((x) => x.classList.toggle("on", reactStore[key] === x.dataset.rx));
    }));
  });
}

// ── participants ("кто на что поставил / кто сколько взял") ────────────────────
function participantEntries(m, withPoints) {
  return (state.users || [])
    .map((u) => ({ nick: u.nickname, p: u.matches?.[m.id], user: u }))
    .filter((e) => e.p && (e.p.home !== "" || e.p.away !== ""))
    .map((e) => ({
      nick: e.nick,
      home: e.p.home, away: e.p.away, bestPlayer: e.p.bestPlayer,
      advance: predictedAdvance(e.p, m),
      pts: withPoints ? matchPointsFor(e.p, m).total : null,
    }))
    .sort((a, b) => (isMe(b.nick) - isMe(a.nick)) || (withPoints ? (b.pts - a.pts) : 0) || (a.nick || "").localeCompare(b.nick || ""));
}
// P1/P2 (OTS-91): колоночная разбивка (флаг стороны прохода · счёт · игрок).
// reveal=false (не начался / лайв) → чужие ставки СКРЫТЫ (антиспойлер): видно
// только кто поставил, а счёт/страна/игрок — под замком до конца матча. Свою
// ставку показываем всегда (для себя это не спойлер). reveal=true только на ended.
function participantsBlock(m, cardId, reveal, label) {
  const withPoints = reveal && getMatchPhase(m) === "ended";
  const ents = participantEntries(m, withPoints);
  if (!ents.length) {
    return `<div class="others empty0" data-ppl="${cardId}"><span>${esc(label)}</span>` +
      `<span class="cnt">0 ставок · будь первым 👀</span></div>`;
  }
  const ko = isKO(m);
  const stack = ents.slice(0, 3).map((e) =>
    `<span style="background:${avColor(e.nick)}">${esc(initials(e.nick))}</span>`).join("");
  const rows = ents.map((e) => {
    const mine = isMe(e.nick);
    const av = `<span class="av" style="background:${avColor(e.nick)}">${esc(initials(e.nick))}</span>`;
    const who = `<span class="who">${mine ? "ты · " : ""}${esc(e.nick)}</span>`;
    if (!(reveal || mine)) {
      return `<div class="ppl masked"><span class="av-slot">${av}</span>${who}` +
        `<span class="lockbet">🔒 скрыто до конца матча</span></div>`;
    }
    const flag = ko
      ? (e.advance ? flagImg(e.advance, "ppl-fl") : `<span class="ppl-fl x" title="проход не выбран">—</span>`)
      : `<span class="ppl-fl x"></span>`;
    const score = `<span class="bet num">${esc(String(e.home ?? "–"))}:${esc(String(e.away ?? "–"))}</span>`;
    const player = `<span class="ppl-pl" title="${esc(e.bestPlayer || "")}">${e.bestPlayer ? esc(e.bestPlayer) : "—"}</span>`;
    const pt = withPoints ? `<span class="pt${e.pts > 0 ? "" : " z"}">${e.pts > 0 ? "+" + e.pts : "0"}</span>` : `<span class="pt none"></span>`;
    const rx = (reveal && !mine) ? reactCluster(m.id, e.nick) : "";
    return `<div class="ppl cols${mine ? " me" : ""}">${av}${who}${flag}${score}${player}${pt}${rx}</div>`;
  }).join("");
  const cnt = reveal
    ? `${ents.length} ${withPoints ? "результата" : "ставок"}`
    : `${ents.length} поставили · 🔒`;
  return `<div class="others" data-ppl="${cardId}"><span>${esc(label)}</span>` +
    `<span class="cnt"><span class="av-stack">${stack}</span>${cnt}<span class="chev">›</span></span></div>` +
    `<div class="ppllist">${rows}</div>`;
}

// ── compact card info: очки за матч + кэфы (свёрнуто — разгрузка карточки) ──────
function cardInfo(m) {
  const sp = stagePoints(m.group);
  const outLab = isKO(m) ? "проход" : "исход";
  const o = m.odds;
  const hasOdds = o && (o.home != null || o.draw != null || o.away != null);
  const oCell = (lab, v) => `<span class="oc"><small>${lab}</small><b>${v != null ? Number(v).toFixed(2) : "—"}</b></span>`;
  const odds = hasOdds ? `<div class="cinfo-odds"><span class="lbl">кэфы</span>${oCell("П1", o.home)}${oCell("Х", o.draw)}${oCell("П2", o.away)}</div>` : "";
  return `<div class="cinfo" data-cinfo>` +
    `<button class="cinfo-t" data-cinfo-t type="button"><span class="pc" data-pc="o">${outLab} +${sp.outcome}</span>` +
    `<span class="pc" data-pc="e">точный +${sp.exact}</span><span class="pc" data-pc="p">игрок +${sp.player}</span>` +
    `<span class="chev">›</span></button>` +
    `<div class="cinfo-body">${odds}<div class="cinfo-note">очки начислятся после матча · черновик сохраняется сам</div></div></div>`;
}

// ── card builders ─────────────────────────────────────────────────────────────
function metaRow(m, timeCls, timeInner) {
  return `<div class="meta"><span class="comp"><img src="/wc2026-logo.png" onerror="this.style.display='none'">FIFA World Cup 26</span>` +
    `<span class="sep"></span><span class="stage${isKO(m) ? " ko" : ""}">${stageLabel(m)}</span>` +
    `<span class="time ${timeCls}">${timeInner}</span></div>`;
}
function teamCol(name, side) {
  const attrs = side ? ` data-team="${esc(name)}" data-side="${side}" role="button" tabindex="0"` : "";
  const tag = side ? `<div class="adv-tag" data-adv-tag></div>` : "";
  return `<div class="team${side ? " sidebtn" : ""}"${attrs}>${flagImg(name)}<div class="nm">${esc(name)}</div>${tag}</div>`;
}

function buildUpcomingCard(m) {
  const id = m.id;
  const pred = currentUser?.matches?.[id];
  const d = { h: pred && pred.home !== "" ? Number(pred.home) : null, a: pred && pred.away !== "" ? Number(pred.away) : null,
    player: pred?.bestPlayer || null, advance: pred?.advance || null, placed: Boolean(pred && pred.home !== ""), changed: false };
  drafts.set(id, d);

  const el = document.createElement("div");
  el.className = "mc" + (d.placed ? " placed" : "");
  el.dataset.state = "upcoming"; el.dataset.active = "1";
  el.dataset.teams = `${m.home} ${m.away}`.toLowerCase();
  el.dataset.home = m.home; el.dataset.away = m.away;
  el.dataset.mid = id;

  const cap = isKO(m) ? "счёт осн. времени" : "твой счёт";
  el.innerHTML =
    metaRow(m, "", timeText(m)) +
    `<div class="body">${teamCol(m.home, isKO(m) ? "home" : null)}` +
      `<div class="mid"><span class="cap" data-cap>${cap}</span><div class="scoreset">` +
        `<span class="stepper"><button data-step="h,-1">−</button><span class="n empty" data-n="h">–</span><button data-step="h,1">+</button></span>` +
        `<span class="col">:</span>` +
        `<span class="stepper"><button data-step="a,-1">−</button><span class="n empty" data-n="a">–</span><button data-step="a,1">+</button></span>` +
      `</div></div>${teamCol(m.away, isKO(m) ? "away" : null)}</div>` +
    `<div class="betrow"><div class="player" data-player><span class="ic">⚽</span>` +
      `<input class="player-inp" data-player-inp type="text" autocomplete="off" spellcheck="false" placeholder="Лучший игрок матча — впиши имя"><span class="chev" data-chev>›</span></div>` +
      `<button class="messi" data-messi title="Спросить Месси"><img src="/messi-ai.webp" alt="Месси"><span class="goat">🐐</span></button></div>` +
    `<div class="ppick" data-ppick><div class="inner" data-ppick-inner><div class="opt" style="justify-content:center;color:var(--dim)">загружаю состав…</div></div></div>` +
    cardInfo(m) +
    `<div class="gowrap"><button class="go" data-go-bet disabled>ВВЕДИ СЧЁТ</button>` +
      `<button class="casino-roll-btn" data-slot type="button">🎰 НАУГАД БЛЯ 🎰</button></div>` +
    participantsBlock(m, id, false, "Кто на что поставил");

  wireUpcoming(el, m, d);
  return el;
}

function buildLiveCard(m) {
  const id = m.id;
  const pred = currentUser?.matches?.[id];
  const myLine = pred && pred.home !== ""
    ? `твой прогноз <b>${esc(pred.home)}:${esc(pred.away)}</b>${pred.bestPlayer ? ` · игрок ${esc(pred.bestPlayer)}` : ""}`
    : `<span style="color:var(--dim)">ты не ставил</span>`;
  const awaiting = Number(m.status) >= 8;
  const el = document.createElement("div");
  el.className = "mc"; el.dataset.state = "live"; el.dataset.active = "1";
  el.dataset.teams = `${m.home} ${m.away}`.toLowerCase(); el.dataset.mid = id;
  el.dataset.home = m.home; el.dataset.away = m.away;
  el.innerHTML =
    metaRow(m, "live", `<i></i>${awaiting ? "ЖДЁМ ИСХОД" : "LIVE"}`) +
    `<div class="livebody">${teamCol(m.home)}` +
      `<div class="livemid"><div class="big num">${m.homeScore ?? 0} : ${m.awayScore ?? 0}</div><div class="yb">${myLine}</div></div>` +
      `${teamCol(m.away)}</div>` +
    participantsBlock(m, id, false, "Кто на что поставил");
  wireParticipants(el);
  return el;
}

function buildEndedCard(m) {
  const id = m.id;
  const actual = resolveActualResult(m);
  const pred = currentUser?.matches?.[id];
  const mp = matchPointsFor(pred, m);
  const sp = stagePoints(m.group);
  const outLab = isKO(m) ? "проход" : "исход";
  const chip = (ok, lab, val) => `<span class="tc ${ok ? "hit" : "miss"}">${ok ? "✓" : "✕"} ${lab} ${ok ? "+" + val : "+0"}</span>`;
  const iBet = pred && pred.home !== "";
  const myLine = iBet ? `твой прогноз <b>${esc(pred.home)}:${esc(pred.away)}</b>` : `<span style="color:var(--dim)">ты не ставил</span>`;
  const el = document.createElement("div");
  el.className = "mc fin"; el.dataset.state = "finished"; el.dataset.active = "1";
  el.dataset.teams = `${m.home} ${m.away}`.toLowerCase(); el.dataset.mid = id;
  el.dataset.home = m.home; el.dataset.away = m.away;
  el.innerHTML =
    metaRow(m, "done", "FT · завершён") +
    `<div class="livebody">${teamCol(m.home)}` +
      `<div class="livemid"><div class="big num">${actual?.home ?? m.homeScore ?? "?"} : ${actual?.away ?? m.awayScore ?? "?"}</div><div class="yb">${myLine}</div></div>` +
      `${teamCol(m.away)}</div>` +
    (iBet ? `<div class="tally">${chip(mp.outcomeCorrect, outLab, sp.outcome)}${chip(mp.exactScore, "точный", sp.exact)}${chip(mp.bestPlayerCorrect, "игрок", sp.player)}<span class="eq">= +${mp.total}</span>` +
      `<button class="share-btn" data-share type="button" title="Поделиться в ТГ">📲 шэр</button></div>` : "") +
    participantsBlock(m, id, true, "Кто сколько взял");
  wireParticipants(el);
  if (iBet) wireShare(el, m, mp);
  return el;
}

// ── share-card (репост результата в ТГ) ───────────────────────────────────────
const VIBE = ["красава 🐐", "жёстко 🔥", "чётко 💪", "по-царски 👑", "фартовый 🍀", "снайпер 🎯", "ну такое 😐", "мимо кассы 🤡", "соснул 💀"];
function vibeWord(pts, seed) {
  let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  if (pts >= 6) return VIBE[h % 6];
  if (pts > 0) return VIBE[3 + (h % 3)];
  return VIBE[6 + (h % 3)];
}
function wireShare(el, m, mp) {
  const btn = el.querySelector("[data-share]"); if (!btn) return;
  btn.addEventListener("click", () => {
    const pred = currentUser?.matches?.[m.id]; const actual = resolveActualResult(m);
    const verdict = mp.exactScore ? { label: "🎯 В ТОЧКУ", tone: "exact" }
      : mp.outcomeCorrect ? { label: "✅ ЗАШЛО", tone: "win" } : { label: "❌ СЛИЛ", tone: "lose" };
    openShareCard({
      home: m.home, away: m.away, homeCode: flagCode(m.home), awayCode: flagCode(m.away),
      homeScore: actual?.home ?? m.homeScore ?? "?", awayScore: actual?.away ?? m.awayScore ?? "?",
      predScore: `${pred.home}:${pred.away}`, pts: mp.total, verdict,
      vibe: vibeWord(mp.total, m.id + (currentUser?.nickname || "")),
      nick: currentUser?.nickname || "Аноним с Otsos",
      typeLine: `${stageLabel(m)} · ЧМ-2026`,
    }, btn);
  });
}

// ── wiring: participants toggle ───────────────────────────────────────────────
function wireParticipants(el) {
  el.querySelector("[data-ppl]")?.addEventListener("click", () => el.classList.toggle("showppl"));
  wireReactions(el);
}

// ── wiring: upcoming bet card ─────────────────────────────────────────────────
function wireUpcoming(el, m, d) {
  const nEl = (k) => el.querySelector(`[data-n="${k}"]`);
  const goBtn = el.querySelector("[data-go-bet]");

  function renderN(k) {
    const v = d[k]; const e = nEl(k);
    if (v == null) { e.textContent = "–"; e.classList.add("empty"); }
    else { e.textContent = v; e.classList.remove("empty"); e.classList.add("bump"); setTimeout(() => e.classList.remove("bump"), 140); }
  }
  function markDraft() { d.changed = true; }   // тихий авто-черновик, без шумного индикатора
  // P5 (OTS-91): проход выбирается кликом по самой команде в шапке карточки —
  // отдельной нижней плашки нет. Решающий счёт → авто-подсветка победителя (лочено).
  // Ничья → тапни команду, которая проходит по пенальти.
  function updateAdvance() {
    if (!isKO(m)) return;
    const teams = [...el.querySelectorAll("[data-side]")];
    const capEl = el.querySelector("[data-cap]");
    teams.forEach((t) => { t.classList.remove("adv-on", "adv-lock", "needpick"); const tag = t.querySelector("[data-adv-tag]"); if (tag) tag.textContent = ""; });
    if (d.h == null || d.a == null) { if (capEl) capEl.textContent = "счёт осн. времени"; return; }
    if (d.h !== d.a) {
      const win = d.h > d.a ? m.home : m.away; d.advance = win;
      teams.forEach((t) => { if (t.dataset.team === win) { t.classList.add("adv-on", "adv-lock"); const tag = t.querySelector("[data-adv-tag]"); if (tag) tag.textContent = "🔒 проходит"; } });
      if (capEl) capEl.textContent = "счёт осн. времени";
    } else if (d.advance) {
      teams.forEach((t) => { if (t.dataset.team === d.advance) { t.classList.add("adv-on"); const tag = t.querySelector("[data-adv-tag]"); if (tag) tag.textContent = "проходит по пен."; } });
      if (capEl) capEl.textContent = "ничья · серия пенальти";
    } else {
      teams.forEach((t) => t.classList.add("needpick"));
      if (capEl) capEl.textContent = "ничья → тапни, кто проходит";
    }
  }
  function refreshGo() {
    let ok = d.h != null && d.a != null;
    if (isKO(m) && d.h === d.a && !d.advance) ok = false;
    const noPlayer = !d.player;
    if (noPlayer) ok = false;                        // P4: без лучшего игрока ставку не принимаем
    goBtn.disabled = !ok;
    if (d.placed && !d.changed) { goBtn.classList.add("done"); goBtn.innerHTML = "✓ Ставка принята · меняй до старта"; goBtn.disabled = false; return; }
    goBtn.classList.remove("done");
    goBtn.textContent = ok ? (d.placed ? "ОБНОВИТЬ СТАВКУ" : "СТАВЛЮ")
      : (d.h == null || d.a == null) ? "ВВЕДИ СЧЁТ"
      : (isKO(m) && d.h === d.a && !d.advance) ? "ВЫБЕРИ КТО ПРОХОДИТ"
      : "ВЫБЕРИ ИГРОКА";
  }

  // steppers
  el.querySelectorAll("[data-step]").forEach((btn) => btn.addEventListener("click", () => {
    const [k, dir] = btn.dataset.step.split(","); const step = Number(dir);
    let v = d[k]; v = v == null ? (step > 0 ? 1 : 0) : v + step;
    if (v < 0) v = 0; if (v > 20) v = 20;
    d[k] = v; renderN(k); markDraft(); updateAdvance(); refreshGo();
  }));

  // compact info toggle (очки + кэфы)
  el.querySelector("[data-cinfo-t]")?.addEventListener("click", () => el.querySelector("[data-cinfo]").classList.toggle("open"));

  // player typeahead (P3): input + живой поиск по составу. Можно выбрать из выдачи
  // ИЛИ вписать своё имя. Список скроллится — больше не тупик.
  const pickWrap = el.querySelector("[data-player]");
  const ppick = el.querySelector("[data-ppick]");
  const plInp = el.querySelector("[data-player-inp]");
  const ppickInner = el.querySelector("[data-ppick-inner]");
  let players = null;
  async function loadPlayers() {
    if (players) return players;
    let list = [];
    try {
      if (m.homeTeamId && m.awayTeamId) {
        const [hp, ap] = await Promise.all([getTeamPlayers(m.homeTeamId), getTeamPlayers(m.awayTeamId)]);
        list = [...hp.map((p) => ({ name: p.name, team: m.home })), ...ap.map((p) => ({ name: p.name, team: m.away }))];
      }
    } catch { /* ignore */ }
    players = list;
    return list;
  }
  function renderPlayerOpts() {
    if (!players) return;
    if (!players.length) { ppickInner.innerHTML = `<div class="opt" style="justify-content:center;color:var(--dim)">состав недоступен — впиши игрока вручную</div>`; return; }
    const q = (plInp.value || "").trim().toLowerCase();
    const filtered = q ? players.filter((p) => p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))) : players;
    if (!filtered.length) { ppickInner.innerHTML = `<div class="opt" style="justify-content:center;color:var(--dim)">никого не нашёл — оставлю «${esc(plInp.value.trim())}»</div>`; return; }
    ppickInner.innerHTML = filtered.slice(0, 40).map((p) => `<div class="opt" data-pick="${esc(p.name)}">${esc(p.name)}<span class="tm">${esc(p.team)}</span></div>`).join("");
    ppickInner.querySelectorAll("[data-pick]").forEach((o) => o.addEventListener("click", () => setPlayer(o.dataset.pick)));
  }
  function setFilled() { pickWrap.classList.toggle("filled", Boolean(d.player)); }
  function setPlayer(name) {
    d.player = (name || "").trim() || null;
    plInp.value = d.player || "";
    setFilled(); ppick.classList.remove("open");
    markDraft(); refreshGo();
  }
  plInp.addEventListener("focus", async () => { ppick.classList.add("open"); await loadPlayers(); renderPlayerOpts(); });
  plInp.addEventListener("input", async () => {
    d.player = plInp.value.trim() || null; setFilled();
    ppick.classList.add("open"); await loadPlayers(); renderPlayerOpts();
    markDraft(); refreshGo();
  });
  plInp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); plInp.blur(); ppick.classList.remove("open"); } });
  document.addEventListener("click", (ev) => { if (!pickWrap.contains(ev.target) && !ppick.contains(ev.target)) ppick.classList.remove("open"); });

  // P5: клик по самой команде → выбор прохода (только при ничье; решающий счёт лочит)
  if (isKO(m)) el.querySelectorAll("[data-side]").forEach((t) => {
    const pick = () => { if (d.h == null || d.a == null || d.h !== d.a) return; d.advance = t.dataset.team; updateAdvance(); markDraft(); refreshGo(); };
    t.addEventListener("click", pick);
    t.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  });

  // messi — async-панель ВНУТРИ карточки (без scrim, без блокировки)
  el.querySelector("[data-messi]").addEventListener("click", () => toggleMessiPanel(el, m));

  // core save routine (общая для CTA и слота)
  async function saveBet(next, opts = {}) {
    const payload = {
      home: String(next.h), away: String(next.a), bestPlayer: next.player || "",
      advance: isKO(m) ? (next.advance || "") : "",
      penalties: isKO(m) ? (next.h === next.a ? "yes" : "no") : "",
    };
    await apiSavePrediction(m.id, payload);
    if (!currentUser.matches) currentUser.matches = {};
    currentUser.matches[m.id] = { ...payload };
    const meU = (state.users || []).find((u) => isMe(u.nickname));
    if (meU) { meU.matches = meU.matches || {}; meU.matches[m.id] = { ...payload }; }
    d.h = next.h; d.a = next.a; d.player = next.player ?? d.player; d.advance = next.advance ?? d.advance;
    d.placed = true; d.changed = false;
    renderN("h"); renderN("a");
    if (d.player) { plInp.value = d.player; pickWrap.classList.add("filled"); }
    el.classList.add("placed", "flash"); setTimeout(() => el.classList.remove("flash"), 720);
    // P6: чипы очков НЕ подсвечиваем зелёным при ставке — только в итоговом подсчёте (ended)
    sparkle(el);
    const lbl = isKO(m) ? `${esc(d.advance)} проходит · ${d.h}:${d.a}` : `${esc(m.home)}–${esc(m.away)} ${d.h}:${d.a}`;
    toast(`<span class="k">✓</span> ${opts.slot ? "Казик решил" : "Ставка принята"} — ${lbl}`);
    updateAdvance(); refreshGo(); refreshMenuAndRail();
  }

  goBtn.addEventListener("click", async () => {
    if (goBtn.disabled) return;
    if (isKO(m) && d.h === d.a && !d.advance) { toast("⚠ ничья → выбери, кто проходит"); return; }
    const prev = goBtn.innerHTML; goBtn.disabled = true; goBtn.innerHTML = "…";
    try { await saveBet({ h: d.h, a: d.a, player: d.player, advance: isKO(m) ? d.advance : "" }); }
    catch (err) {
      goBtn.innerHTML = prev; goBtn.disabled = false;
      toast((err?.message || "").includes("начал") ? "⛔ Матч уже начался — ставка не принята" : "Ошибка, попробуй ещё");
    }
  });

  // 🎰 НАУГАД БЛЯ — слот-машина: крутит счёт + игрока → авто-ставка
  el.querySelector("[data-slot]")?.addEventListener("click", async () => {
    if (!isCasinoMode()) return;
    const pool = (await loadPlayers()) || [];
    const res = await runScoreSlot(pool);
    if (!res) return;
    const h = Number(res.home), a = Number(res.away);
    const advance = isKO(m) ? (h === a ? m.home : (h > a ? m.home : m.away)) : "";
    try { await saveBet({ h, a, player: res.player, advance }, { slot: true }); }
    catch (err) { toast((err?.message || "").includes("начал") ? "⛔ Матч уже начался" : "Казик промахнулся, попробуй ещё"); }
  });

  wireParticipants(el);
  if (d.h != null) renderN("h"); if (d.a != null) renderN("a");
  if (d.player) { plInp.value = d.player; setFilled(); }
  updateAdvance(); refreshGo();
}

// ── Messi async-панель внутри карточки (реальная AI-подсказка) ────────────────
const MESSI_LOADING = ["Лео достаёт инсайд…", "Лео смотрит запись…", "Лео звонит пацанам…", "Лео листает составы…", "ГОАТ на проводе…"];
function toggleMessiPanel(el, m) {
  const btn = el.querySelector("[data-messi]");
  let panel = el.querySelector(".messi-panel");
  if (panel && !panel.dataset.loading) {
    // повторный клик — свернуть/развернуть, бэк не дёргаем
    const open = panel.classList.toggle("open");
    btn.classList.toggle("on", open);
    return;
  }
  if (panel) return; // грузится
  panel = document.createElement("div");
  panel.className = "messi-panel open";
  panel.dataset.loading = "1";
  el.querySelector(".body").insertAdjacentElement("afterend", panel);
  btn.classList.add("on", "busy");
  let i = 0;
  panel.innerHTML = `<img class="mp-ava" src="/messi-ai.webp" alt=""><div class="mp-body"><span class="mp-load"></span><span class="typing"><i></i><i></i><i></i></span></div>`;
  const loadEl = panel.querySelector(".mp-load");
  loadEl.textContent = MESSI_LOADING[0];
  const loop = setInterval(() => { i = (i + 1) % MESSI_LOADING.length; loadEl.textContent = MESSI_LOADING[i]; }, 1600);
  apiMatchHint(m.id).then((res) => {
    clearInterval(loop);
    const hint = (res?.hint || "Месси задумался и промолчал 🤔").trim();
    panel.innerHTML = `<img class="mp-ava" src="/messi-ai.webp" alt=""><div class="mp-body mp-done"></div>`;
    panel.querySelector(".mp-body").textContent = hint;
  }).catch((err) => {
    clearInterval(loop);
    const msg = (err?.message || "").toLowerCase();
    panel.innerHTML = `<img class="mp-ava" src="/messi-ai.webp" alt=""><div class="mp-body mp-err"></div>`;
    panel.querySelector(".mp-body").textContent = msg.includes("429") || msg.includes("много")
      ? "Слишком часто спрашиваешь 😅 дай Месси перевести дух — попробуй через пару минут."
      : "Месси сейчас занят (тренировка 🐐). Попробуй чуть позже.";
  }).finally(() => { delete panel.dataset.loading; btn.classList.remove("busy"); });
}

// ── casino sparkle (при принятой ставке) ─────────────────────────────────────
function sparkle(card) {
  const r = card.getBoundingClientRect();
  for (let i = 0; i < 9; i++) { const c = document.createElement("div"); c.className = "coin"; c.textContent = "✨";
    c.style.left = (r.left + Math.random() * r.width) + "px"; c.style.top = (r.top + 18) + "px"; c.style.position = "fixed";
    c.style.animationDuration = (1 + Math.random() * 0.8) + "s"; c.style.fontSize = "16px";
    document.body.appendChild(c); setTimeout(() => c.remove(), 1800); }
}
function onCasinoToggle(on) { toast(on ? "🎰 Режим казика — врубили" : "казик выключен 😌"); }
function onJackpot(res) {
  const who = currentUser?.nickname || "Санёк";
  toast(`🎰 ${esc(who)} крутанул ДЖЕКПОТ ${esc(res.home)}:${esc(res.away)}!`);
  jackpotTicker(`🎰 ${who} крутанул джекпот ${res.home}:${res.away}`);
}
let jackpotMsg = null;
function jackpotTicker(msg) { jackpotMsg = { msg, until: Date.now() + 60000 }; $("ticker").style.display = ""; renderTicker(); }

// ── filters / feed render ────────────────────────────────────────────────────
const TITLES = { live: "В лайве прямо сейчас", today: "Матчи сегодня", all: "Все матчи" };
const SUBTITLES = { all: "Все матчи", future: "Будущие матчи", finished: "Завершённые матчи", nobet: "Без твоей ставки" };

function feedPool() {
  const seen = new Set();
  const pool = [];
  for (const m of activeMatches) { if (!seen.has(m.id)) { seen.add(m.id); pool.push(m); } }
  for (const m of FUTURE) { if (!seen.has(m.id)) { seen.add(m.id); pool.push(m); } }
  // OTS-87: сорт по убыванию — не-завершённые ближайшее сверху, завершённые свежее сверху.
  return pool.sort((a, b) => {
    const fa = getMatchPhase(a) === "ended", fb = getMatchPhase(b) === "ended";
    if (fa !== fb) return fa ? 1 : -1;
    const cmp = String(a.dateTimeRaw).localeCompare(String(b.dateTimeRaw));
    return fa ? -cmp : cmp;
  });
}
function renderFeed() {
  const list = $("feedList"); list.innerHTML = "";
  if (degraded) {
    const b = document.createElement("div");
    b.className = "hero"; b.style.borderColor = "rgba(255,203,69,.4)";
    b.innerHTML = `<div><h3>⚠ Данные могут быть неполными</h3><p>Провайдер матчей временно недоступен — показываем из кэша.</p></div>`;
    list.appendChild(b);
  }
  for (const m of feedPool()) {
    const phase = getMatchPhase(m);
    const inActive = activeMatches.some((x) => x.id === m.id);
    let card;
    if (phase === "live") card = buildLiveCard(m);
    else if (phase === "ended") card = buildEndedCard(m);
    else card = buildUpcomingCard(m);
    card.dataset.active = inActive ? "1" : "0";
    const pred = currentUser?.matches?.[m.id];
    card.dataset.bet = pred && pred.home !== "" ? "1" : "0";
    list.appendChild(card);
  }
  applyFilters();
}
function cardVisible(card) {
  const st = card.dataset.state, active = card.dataset.active === "1";
  if (curCountry) {
    const cc = flagCode(curCountry);
    if (flagCode(card.dataset.home) !== cc && flagCode(card.dataset.away) !== cc) return false;
  }
  if (curFilter === "live") return st === "live";
  if (curFilter === "today") return active && st !== "finished";
  // вью «Все» + теги-подфильтры (toggle). curSub === null → показываем всё.
  if (curSub === "future") return st === "upcoming";
  if (curSub === "finished") return st === "finished";
  if (curSub === "nobet") return st !== "finished" && card.dataset.bet !== "1";
  return true;
}
function applyFilters() {
  const q = ($("searchInput").value || "").trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll("#feedList .mc").forEach((card) => {
    let ok = cardVisible(card);
    if (ok && q) ok = (card.dataset.teams || "").includes(q);
    card.style.display = ok ? "" : "none"; if (ok) shown++;
  });
  document.querySelectorAll("#seg button").forEach((b) => b.classList.toggle("on", b.dataset.f === curFilter));
  movePill();
  $("feedTitle").textContent = curFilter === "all" ? (SUBTITLES[curSub] || SUBTITLES.all) : TITLES[curFilter];
  const w = shown + " " + (shown === 1 ? "матч" : (shown >= 2 && shown <= 4 ? "матча" : "матчей"));
  $("feedCount").textContent = w + (curCountry ? ` · ${curCountry}` : "");
  $("emptyState").style.display = shown ? "none" : "block";
}
function movePill() {
  const seg = $("seg"), pill = $("segPill");
  const on = seg.querySelector("button.on"); if (!on) return;
  pill.style.width = on.offsetWidth + "px";
  pill.style.transform = "translateX(" + (on.offsetLeft - 4) + "px)";
}
function setFilter(f) {
  curFilter = f;
  const sub = $("subseg");
  if (f === "all") sub.classList.add("show");
  else { sub.classList.remove("show"); curSub = null; syncSub(); }
  applyFilters();
}
// toggle: повторный клик по активному тегу снимает фильтр (curSub → null → все матчи)
function setSub(s) { curSub = curSub === s ? null : s; syncSub(); applyFilters(); }
function syncSub() { document.querySelectorAll("#subseg .subchip").forEach((b) => b.classList.toggle("on", b.dataset.s === curSub)); }
function defaultFilter() { return feedPool().some((m) => getMatchPhase(m) === "live") ? "live" : "today"; }

// ── country picker ─────────────────────────────────────────────────────────────
function buildCountryPicker() {
  // dedup by flag code — feed may carry aliases of one country (Czech Republic/Czechia)
  const byCode = new Map();
  for (const m of feedPool()) {
    for (const nm of [m.home, m.away]) {
      const code = flagCode(nm);
      if (!code) continue;
      const cur = byCode.get(code);
      if (!cur || nm.localeCompare(cur, "ru") < 0) byCode.set(code, nm);
    }
  }
  const sorted = [...byCode.values()].sort((a, b) => a.localeCompare(b, "ru"));
  const list = $("ctryList");
  const row = (name) => `<button class="ctry-opt${curCountry === name ? " on" : ""}" data-ctry="${esc(name)}">${flagImg(name, "ctry-opt-fl")}<span>${esc(name)}</span></button>`;
  list.innerHTML = `<button class="ctry-opt${!curCountry ? " on" : ""}" data-ctry=""><span class="ctry-opt-fl e">🌍</span><span>Все страны</span></button>` + sorted.map(row).join("");
  list.querySelectorAll("[data-ctry]").forEach((b) => b.addEventListener("click", () => setCountry(b.dataset.ctry || null)));
}
function setCountry(name) {
  curCountry = name;
  const btn = $("ctryBtn");
  btn.classList.toggle("on", Boolean(name));
  $("ctryLabel").textContent = name || "Страна";
  $("ctryFl").innerHTML = name && flagCode(name) ? flagImg(name, "ctry-fl-img") : "🌍";
  closeCountry();
  applyFilters();
}
function openCountry() { buildCountryPicker(); document.body.classList.add("ctry-open"); }
function closeCountry() { document.body.classList.remove("ctry-open"); }

// ── bracket (настоящая сетка-дерево) ─────────────────────────────────────────
function renderBracket() {
  const pool = feedPool();
  const koCount = pool.filter((m) => classifyKnockoutRound(m.group)).length;
  const myPO = renderBracketTree($("bracket"), pool, currentUser);
  $("bkMine").textContent = "+" + myPO;
  $("bkHint").textContent = koCount === 0
    ? "Плей-офф ещё не начался — висит скелет реальной сетки ЧМ-2026. Команды и счёт встанут на свои места сами 🏆"
    : "";
}

// ── leaderboard arena ────────────────────────────────────────────────────────
// P7 (OTS-91): основная таблица = плей-офф (очки только за стадию на вылет).
// Глобальная (с групповым этапом) вторична — свёрнута в <details>.
function userPlayoffPoints(u) {
  let s = 0;
  for (const m of feedPool()) {
    if (!classifyKnockoutRound(m.group)) continue;
    const pr = u.matches?.[m.id];
    if (pr) s += matchPointsFor(pr, m).total;
  }
  return s;
}
function sortedByPlayoff() {
  return [...(state.users || [])]
    .filter((u) => u.onboardingComplete !== false)
    .map((u) => ({ u, pts: userPlayoffPoints(u) }))
    .sort((a, b) => b.pts - a.pts || (a.u.nickname || "").localeCompare(b.u.nickname || ""));
}
function arenaRows(list, mv) {
  return list.map((x, i) => {
    const me = isMe(x.u.nickname);
    const arrow = mv
      ? ((mv[x.u.nickname] || 0) > 0 ? `<span class="mvt up">▲${mv[x.u.nickname]}</span>`
        : (mv[x.u.nickname] || 0) < 0 ? `<span class="mvt dn">▼${-mv[x.u.nickname]}</span>` : `<span class="mvt fl">—</span>`)
      : "";
    let chase = "";
    if (me && list[i + 1]) { const gap = x.pts - list[i + 1].pts; chase = `<div class="chase">${esc(list[i + 1].u.nickname)} догоняет на ${gap} 👀</div>`; }
    return `<div class="arow${me ? " me" : ""}${i === 0 ? " lead" : ""}">` +
      `<span class="ar-rank">${i + 1}</span>${arrow}` +
      `<span class="ar-av" style="background:${avColor(x.u.nickname)}">${esc(initials(x.u.nickname))}</span>` +
      `<span class="ar-who">${me ? "ты · " : ""}${esc(x.u.nickname)}${chase}</span>` +
      `<span class="ar-pts num">${x.pts}</span></div>`;
  }).join("");
}
function renderLeaderboard() {
  const anyKO = feedPool().some((m) => classifyKnockoutRound(m.group));
  const po = sortedByPlayoff();
  const myIdx = po.findIndex((x) => isMe(x.u.nickname));
  const myPts = myIdx >= 0 ? po[myIdx].pts : 0;
  $("lbMine").innerHTML = anyKO
    ? (myIdx >= 0 ? `ты — <b>${myIdx + 1} место</b> · ${myPts} очков за плей-офф` : "сделай ставку на плей-офф 👇")
    : "плей-офф ещё впереди 🏆";
  $("lbList").innerHTML = anyKO
    ? (arenaRows(po, null) || `<div class="empty" style="display:block">Пока пусто 👇</div>`)
    : `<div class="lb-empty">Плей-офф ещё не начался — здесь появится таблица за стадию на вылет. Пока смотри общий зачёт ниже 👇</div>`;
  // глобальная (вторичная) — с учётом группового этапа
  const { mv, now } = movementMap();
  const gList = $("lbGlobalList");
  if (gList) gList.innerHTML = arenaRows(now, mv) || `<div class="empty" style="display:block">Пока пусто 👇</div>`;
}

// ── header / rail / menu ─────────────────────────────────────────────────────
function refreshMenuAndRail() {
  const st = myStanding();
  $("ptsVal").textContent = st.pts;
  const hero = $("hero");
  hero.style.display = "flex";
  $("heroHi").innerHTML = `С возвращением, ${esc(currentUser.nickname)} 🫡`;
  $("heroRank").textContent = st.rank || "–";
  const list = sortedUsers();
  if (st.rank && st.rank > 5) {
    const gap = list[4] ? list[4].pts - st.pts : 0;
    $("heroSub").textContent = gap > 0 ? `До топ-5 — ${gap} очков 👀` : "Ты в топе 🔥";
  } else $("heroSub").textContent = st.rank ? "Ты в топ-5 🔥" : "Сделай первую ставку 👇";
  const rail = $("railLb");
  const top = list.slice(0, 5);
  const rows = top.map((x, i) => lbRow(i + 1, x));
  if (st.rank && st.rank > 5) rows.push(lbRow(st.rank, list[st.rank - 1]));
  rail.innerHTML = rows.join("");
  const anyLive = feedPool().some((m) => getMatchPhase(m) === "live");
  const liveDot = $("menuLiveDot"); if (liveDot) liveDot.style.display = anyLive ? "" : "none";
  const showTk = anyLive || (jackpotMsg && jackpotMsg.until > Date.now());
  $("ticker").style.display = showTk ? "" : "none";
  if (showTk) renderTicker();
}
function lbRow(rank, x) {
  const me = isMe(x.u.nickname);
  return `<div class="lb${me ? " me" : ""}"><span class="r">${rank}</span>` +
    `<span class="av" style="background:${avColor(x.u.nickname)}">${esc(initials(x.u.nickname))}</span>` +
    `<span class="who">${me ? "ты · " : ""}${esc(x.u.nickname)}</span><span class="p num">${x.pts}</span></div>`;
}
function renderTicker() {
  const tk = $("tk");
  const live = feedPool().filter((m) => getMatchPhase(m) === "live");
  const items = live.map((m) => `<span>${esc(m.home)} <span class="sc">${m.homeScore ?? 0}:${m.awayScore ?? 0}</span> ${esc(m.away)}</span>`);
  if (jackpotMsg && jackpotMsg.until > Date.now()) items.unshift(`<span class="jackpot">${esc(jackpotMsg.msg)}</span>`);
  if (!items.length) { tk.innerHTML = ""; return; }
  tk.innerHTML = (items.join("") + items.join(""));
}

// ── nav ──────────────────────────────────────────────────────────────────────
function closeAll() { document.body.classList.remove("menu-open"); closeCountry(); }
function showView(vid) {
  document.querySelectorAll(".view").forEach((x) => x.classList.toggle("on", x.id === vid));
  // P8/P9: в разделах «Таблица» и «Сетка» правый рейл убираем (не дублируем) и
  // отдаём весь экран контенту — сетка видна целиком.
  document.body.classList.toggle("view-wide", vid === "view-lb" || vid === "view-bracket");
}
function setMenuActive(v) { document.querySelectorAll(".menu .mi").forEach((mi) => mi.classList.toggle("on", mi.dataset.v === v)); }
function go(v) {
  closeAll();
  if (v === "old") { window.location.href = "/"; return; }
  if (v === "live") { showView("view-feed"); setFilter("live"); setMenuActive("feed"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (v === "lb") { showView("view-lb"); renderLeaderboard(); setMenuActive("lb"); }
  else if (v === "bracket") { showView("view-bracket"); renderBracket(); setMenuActive("bracket"); }
  else { showView("view-feed"); setFilter(defaultFilter()); setMenuActive("feed"); }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function wireChrome() {
  $("burger").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  $("scrim").addEventListener("click", closeAll);
  $("logo").addEventListener("click", casinoToggle);
  $("casinoBtn").addEventListener("click", () => { casinoToggle(); closeAll(); });
  $("ptsBtn").addEventListener("click", () => go("lb"));
  document.querySelectorAll(".menu .mi[data-v]").forEach((mi) => mi.addEventListener("click", () => go(mi.dataset.v)));
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $("seg").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.f)));
  $("subseg").querySelectorAll(".subchip").forEach((b) => b.addEventListener("click", () => setSub(b.dataset.s)));
  $("searchInput").addEventListener("input", applyFilters);
  $("ctryBtn").addEventListener("click", () => document.body.classList.contains("ctry-open") ? closeCountry() : openCountry());
  $("ctryScrim").addEventListener("click", closeCountry);
  window.addEventListener("resize", movePill);
}

// ── boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  let me;
  try { me = await apiMe(); } catch { me = null; }
  if (!me) { window.location.href = "/"; return; }

  const [matchesRes, lb, preds, future] = await Promise.all([
    fetchMatchesFromSportDb().catch(() => ({ matches: [], degraded: false })),
    apiGetLeaderboard().catch(() => ({ users: [], actualMatches: {}, actualOutrights: {} })),
    apiGetPredictions().catch(() => ({})),
    fetchUpcomingMatches().catch(() => []),
  ]);
  setActiveMatches(matchesRes.matches || []);
  degraded = Boolean(matchesRes.degraded);
  updateStateFromServer(lb);
  FUTURE = Array.isArray(future) ? future : [];
  const myOut = (state.users || []).find((u) => (u.nickname || "").toLowerCase() === me.nickname.toLowerCase())?.outrights || {};
  setCurrentUser({ ...me, matches: preds || {}, outrights: myOut });

  wireChrome();
  setupCasino($("logo"), { onToggle: onCasinoToggle, onJackpot });
  curFilter = defaultFilter();
  renderFeed();
  refreshMenuAndRail();
  setTimeout(movePill, 100);
}

boot();
