// ============================================================================
// ОТСОС · дизайн v3 (OTS-82) — off-neon премиум, отдельный раздел за гейтом Тимы.
// Переиспользует РЕАЛЬНЫЙ дата-слой v2 (api-client / api / store / points),
// рендерит по-новому. Механика только реальная (points.js — единый источник).
// Старый дизайн не тронут: это отдельная страница /v3, свой DOM и стили.
// ============================================================================
import { apiMe, apiGetPredictions, apiGetLeaderboard, apiSavePrediction, apiMatchHint } from "../api-client.js";
import { fetchMatchesFromSportDb, fetchUpcomingMatches, getTeamPlayers } from "../api.js";
import { state, updateStateFromServer, setActiveMatches, activeMatches, setCurrentUser, currentUser } from "../store.js";
import { getMatchPhase, classifyKnockoutRound, matchPointsFor, resolveActualResult, predictedAdvance, stagePoints } from "../points.js";
import { getUserTotalPoints } from "../points.js";
import { escapeHtml } from "../utils.js";
import { flagImg } from "./flags.js";

const $ = (id) => document.getElementById(id);
const esc = escapeHtml;

let FUTURE = [];          // будущие матчи вне сегодняшнего горизонта
let degraded = false;     // провайдер лёг → данные неполные
const drafts = new Map(); // matchId → {h,a,player,advance,placed,changed}
let curFilter = "today", curSub = "all";

// ── helpers ────────────────────────────────────────────────────────────────
const KO_RU = { R32: "1/16 финала", R16: "1/8 финала", QF: "1/4 финала", SF: "1/2 финала", F: "Финал" };
function stageLabel(m) {
  const ko = classifyKnockoutRound(m.group);
  if (ko) return KO_RU[ko];
  const g = m.group || "";
  const md = g.match(/Group Stage\s*-?\s*(\d+)/i);   // "Group Stage - 1" → тур группового этапа
  if (md) return `Групповой этап · ${md[1]} тур`;
  const gl = g.match(/^Group\s+([A-Z])\b/i);          // "Group A" → "Группа A"
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
    .sort((a, b) => (withPoints ? (b.pts - a.pts) : 0) || (isMe(b.nick) - isMe(a.nick)));
}
function participantsBlock(m, cardId, withPoints, label) {
  const ents = participantEntries(m, withPoints);
  if (!ents.length) return "";
  const stack = ents.slice(0, 3).map((e) =>
    `<span style="background:${avColor(e.nick)}">${esc(initials(e.nick))}</span>`).join("");
  const rows = ents.map((e) => {
    const adv = isKO(m) && e.advance ? `<span class="adv2">↗ ${esc(e.advance)}</span>` : "";
    const pt = withPoints ? `<span class="pt${e.pts > 0 ? "" : " z"}">${e.pts > 0 ? "+" + e.pts : "0"}</span>` : "";
    return `<div class="ppl${isMe(e.nick) ? " me" : ""}"><span class="av" style="background:${avColor(e.nick)}">${esc(initials(e.nick))}</span>` +
      `<span class="who">${isMe(e.nick) ? "ты · " : ""}${esc(e.nick)}</span>${adv}` +
      `<span class="bet num">${esc(String(e.home ?? "–"))}:${esc(String(e.away ?? "–"))}</span>${pt}</div>`;
  }).join("");
  return `<div class="others" data-ppl="${cardId}"><span>${esc(label)}</span>` +
    `<span class="cnt"><span class="av-stack">${stack}</span>${ents.length} ${withPoints ? "ставок" : "поставили"}<span class="chev">›</span></span></div>` +
    `<div class="ppllist">${rows}</div>`;
}

// ── odds info (НЕ кликаются — чистая инфа) ────────────────────────────────────
function oddsBlock(m) {
  const o = m.odds;
  if (!o || (o.home == null && o.draw == null && o.away == null)) return "";
  const cell = (lab, v) => `<div class="o"><small>${lab}</small><b>${v != null ? Number(v).toFixed(2) : "—"}</b></div>`;
  return `<div class="odds"><span class="ol">кэфы</span>${cell("П1", o.home)}${cell("Х", o.draw)}${cell("П2", o.away)}</div>`;
}
function pointsChips(m, id) {
  const sp = stagePoints(m.group);
  const outLab = isKO(m) ? "проход" : "исход";
  return `<div class="pts-row">` +
    `<span class="pc" data-pc="o">${outLab} +${sp.outcome}</span>` +
    `<span class="pc" data-pc="e">точный +${sp.exact}</span>` +
    `<span class="pc" data-pc="p">игрок +${sp.player}</span>` +
    `<span class="draft" data-draft><span class="d"></span>черновик пуст</span></div>`;
}

// ── card builders ─────────────────────────────────────────────────────────────
function metaRow(m, timeCls, timeInner) {
  return `<div class="meta"><span class="comp"><img src="/wc2026-logo.png" onerror="this.style.display='none'">FIFA World Cup 26</span>` +
    `<span class="sep"></span><span class="stage${isKO(m) ? " ko" : ""}">${stageLabel(m)}</span>` +
    `<span class="time ${timeCls}">${timeInner}</span></div>`;
}
function teamCol(name) {
  return `<div class="team">${flagImg(name)}<div class="nm">${esc(name)}</div></div>`;
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
  el.dataset.mid = id;

  const cap = isKO(m) ? "счёт осн. времени" : "твой счёт";
  el.innerHTML =
    metaRow(m, "", timeText(m)) +
    `<div class="body">${teamCol(m.home)}` +
      `<div class="mid"><span class="cap">${cap}</span><div class="scoreset">` +
        `<span class="stepper"><button data-step="h,-1">−</button><span class="n empty" data-n="h">–</span><button data-step="h,1">+</button></span>` +
        `<span class="col">:</span>` +
        `<span class="stepper"><button data-step="a,-1">−</button><span class="n empty" data-n="a">–</span><button data-step="a,1">+</button></span>` +
      `</div></div>${teamCol(m.away)}</div>` +
    oddsBlock(m) +
    (isKO(m) ? `<div class="advwrap" data-advwrap style="display:none"><div class="advlab" data-advlab></div>` +
      `<div class="adv" data-adv><div class="a" data-adv-team="${esc(m.home)}">${flagImg(m.home, "advfl")} ${esc(m.home)}</div>` +
      `<div class="a" data-adv-team="${esc(m.away)}">${flagImg(m.away, "advfl")} ${esc(m.away)}</div></div></div>` : "") +
    `<div class="betrow"><div class="player" data-player><span class="ic">⚽</span><span data-pltext>Лучший игрок матча</span><span class="chev" data-chev>выбрать ›</span></div>` +
      `<button class="messi" data-messi title="Спросить Месси"><img src="/messi-ai.webp" alt="Месси"><span class="goat">🐐</span></button></div>` +
    `<div class="ppick" data-ppick><div class="inner" data-ppick-inner><div class="opt" style="justify-content:center;color:var(--dim)">загружаю состав…</div></div></div>` +
    `<div class="foot">${pointsChips(m, id)}</div>` +
    `<div class="gowrap"><button class="go" data-go-bet disabled>ВВЕДИ СЧЁТ</button></div>` +
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
  el.innerHTML =
    metaRow(m, "live", `<i></i>${awaiting ? "ЖДЁМ ИСХОД" : "LIVE"}`) +
    `<div class="livebody">${teamCol(m.home)}` +
      `<div class="livemid"><div class="big num">${m.homeScore ?? 0} : ${m.awayScore ?? 0}</div><div class="yb">${myLine}</div></div>` +
      `${teamCol(m.away)}</div>` +
    oddsBlock(m) +
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
  const myLine = pred && pred.home !== ""
    ? `твой прогноз <b>${esc(pred.home)}:${esc(pred.away)}</b>`
    : `<span style="color:var(--dim)">ты не ставил</span>`;
  const el = document.createElement("div");
  el.className = "mc fin"; el.dataset.state = "finished"; el.dataset.active = "1";
  el.dataset.teams = `${m.home} ${m.away}`.toLowerCase(); el.dataset.mid = id;
  el.innerHTML =
    metaRow(m, "done", "FT · завершён") +
    `<div class="livebody">${teamCol(m.home)}` +
      `<div class="livemid"><div class="big num">${actual?.home ?? m.homeScore ?? "?"} : ${actual?.away ?? m.awayScore ?? "?"}</div><div class="yb">${myLine}</div></div>` +
      `${teamCol(m.away)}</div>` +
    (pred && pred.home !== "" ? `<div class="tally">${chip(mp.outcomeCorrect, outLab, sp.outcome)}${chip(mp.exactScore, "точный", sp.exact)}${chip(mp.bestPlayerCorrect, "игрок", sp.player)}<span class="eq">= +${mp.total}</span></div>` : "") +
    participantsBlock(m, id, true, "Кто сколько взял");
  wireParticipants(el);
  return el;
}

// ── wiring: participants toggle ───────────────────────────────────────────────
function wireParticipants(el) {
  el.querySelector("[data-ppl]")?.addEventListener("click", () => el.classList.toggle("showppl"));
}

// ── wiring: upcoming bet card ─────────────────────────────────────────────────
function wireUpcoming(el, m, d) {
  const nEl = (k) => el.querySelector(`[data-n="${k}"]`);
  const draftEl = el.querySelector("[data-draft]");
  const goBtn = el.querySelector("[data-go-bet]");
  let draftTimer;

  function renderN(k) {
    const v = d[k]; const e = nEl(k);
    if (v == null) { e.textContent = "–"; e.classList.add("empty"); }
    else { e.textContent = v; e.classList.remove("empty"); e.classList.add("bump"); setTimeout(() => e.classList.remove("bump"), 140); }
  }
  function markDraft() {
    d.changed = true;
    if (!draftEl) return;
    draftEl.classList.remove("saved"); draftEl.classList.add("saving");
    draftEl.innerHTML = '<span class="d"></span>черновик…';
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { draftEl.classList.remove("saving"); draftEl.classList.add("saved"); draftEl.innerHTML = '<span class="d"></span>черновик сохранён ✓'; }, 600);
  }
  function updateAdvance() {
    if (!isKO(m)) return;
    const wrap = el.querySelector("[data-advwrap]"), lab = el.querySelector("[data-advlab]"), adv = el.querySelector("[data-adv]");
    if (d.h == null || d.a == null) { wrap.style.display = "none"; return; }
    wrap.style.display = "block";
    const opts = [...adv.querySelectorAll(".a")];
    opts.forEach((o) => o.classList.remove("sel", "locked"));
    adv.classList.remove("needpick");
    if (d.h !== d.a) {
      const win = d.h > d.a ? m.home : m.away; d.advance = win;
      opts.forEach((o) => {
        const team = o.dataset.advTeam;
        o.innerHTML = (team === win ? "🔒 " : "") + flagImg(team, "advfl") + " " + esc(team) + (team === win ? " проходит" : "");
        if (team === win) o.classList.add("locked");
      });
      lab.innerHTML = 'Кто проходит <span class="lock">🔒 авто — победитель по счёту</span>';
    } else {
      opts.forEach((o) => { o.innerHTML = flagImg(o.dataset.advTeam, "advfl") + " " + esc(o.dataset.advTeam); if (o.dataset.advTeam === d.advance) o.classList.add("sel"); });
      if (!d.advance) { adv.classList.add("needpick"); lab.innerHTML = 'Кто проходит <span class="req">⚠ ничья → пенальти · выбери обязательно</span>'; }
      else lab.innerHTML = 'Кто проходит <span class="req">пенальти · твой выбор</span>';
    }
  }
  function refreshGo() {
    let ok = d.h != null && d.a != null;
    if (isKO(m) && d.h === d.a && !d.advance) ok = false;
    goBtn.disabled = !ok;
    if (d.placed && !d.changed) { goBtn.classList.add("done"); goBtn.innerHTML = "✓ Ставка принята · меняй до старта"; goBtn.disabled = false; return; }
    goBtn.classList.remove("done");
    goBtn.textContent = ok ? (d.placed ? "ОБНОВИТЬ СТАВКУ" : "СТАВЛЮ")
      : (d.h == null || d.a == null ? "ВВЕДИ СЧЁТ" : "ВЫБЕРИ КТО ПРОХОДИТ");
  }

  // steppers
  el.querySelectorAll("[data-step]").forEach((btn) => btn.addEventListener("click", () => {
    const [k, dir] = btn.dataset.step.split(","); const step = Number(dir);
    let v = d[k]; v = v == null ? (step > 0 ? 1 : 0) : v + step;
    if (v < 0) v = 0; if (v > 20) v = 20;
    d[k] = v; renderN(k); markDraft(); updateAdvance(); refreshGo();
  }));

  // player picker
  const pickWrap = el.querySelector("[data-player]");
  const ppick = el.querySelector("[data-ppick]");
  let players = null;
  async function loadPlayers() {
    if (players) return players;
    const inner = el.querySelector("[data-ppick-inner]");
    let list = [];
    try {
      if (m.homeTeamId && m.awayTeamId) {
        const [hp, ap] = await Promise.all([getTeamPlayers(m.homeTeamId), getTeamPlayers(m.awayTeamId)]);
        list = [...hp.map((p) => ({ name: p.name, team: m.home })), ...ap.map((p) => ({ name: p.name, team: m.away }))];
      }
    } catch { /* ignore */ }
    players = list;
    if (!list.length) inner.innerHTML = `<div class="opt" style="justify-content:center;color:var(--dim)">состав недоступен — впиши игрока в «Спросить Месси»</div>`;
    else inner.innerHTML = list.map((p) => `<div class="opt" data-pick="${esc(p.name)}">${esc(p.name)}<span class="tm">${esc(p.team)}</span></div>`).join("");
    inner.querySelectorAll("[data-pick]").forEach((o) => o.addEventListener("click", () => setPlayer(o.dataset.pick)));
    return list;
  }
  function setPlayer(name) {
    d.player = name;
    el.querySelector("[data-pltext]").textContent = name;
    pickWrap.classList.add("filled");
    el.querySelector("[data-chev]").textContent = "менять ›";
    el.querySelector('[data-pc="p"]')?.classList.add("hit");
    ppick.classList.remove("open");
    markDraft(); refreshGo();
  }
  pickWrap.addEventListener("click", async () => { ppick.classList.toggle("open"); if (ppick.classList.contains("open")) await loadPlayers(); });

  // advance manual pick (draw only)
  if (isKO(m)) el.querySelector("[data-adv]").addEventListener("click", (ev) => {
    const opt = ev.target.closest(".a"); if (!opt) return;
    if (d.h == null || d.a == null || d.h !== d.a) return; // locked when decisive
    d.advance = opt.dataset.advTeam; updateAdvance(); markDraft(); refreshGo();
  });

  // messi
  el.querySelector("[data-messi]").addEventListener("click", () => openMessi(m));

  // place / update bet
  goBtn.addEventListener("click", async () => {
    if (goBtn.disabled) return;
    if (isKO(m) && d.h === d.a && !d.advance) { toast("⚠ ничья → выбери, кто проходит"); return; }
    const payload = {
      home: String(d.h), away: String(d.a), bestPlayer: d.player || "",
      advance: isKO(m) ? (d.advance || "") : "",
      penalties: isKO(m) ? (d.h === d.a ? "yes" : "no") : "",
    };
    goBtn.disabled = true; const prev = goBtn.innerHTML; goBtn.innerHTML = "…";
    try {
      await apiSavePrediction(m.id, payload);
      if (!currentUser.matches) currentUser.matches = {};
      currentUser.matches[m.id] = { ...payload };
      // отразить в state.users (для «кто поставил» без перезагрузки)
      const meU = (state.users || []).find((u) => isMe(u.nickname));
      if (meU) { meU.matches = meU.matches || {}; meU.matches[m.id] = { ...payload }; }
      d.placed = true; d.changed = false;
      el.classList.add("placed", "flash"); setTimeout(() => el.classList.remove("flash"), 720);
      ["o", "e", "p"].forEach((s) => el.querySelector(`[data-pc="${s}"]`)?.classList.add("hit"));
      if (draftEl) { draftEl.classList.remove("saving"); draftEl.classList.add("saved"); draftEl.innerHTML = '<span class="d"></span>сохранено · меняй до старта'; }
      sparkle(el);
      const lbl = isKO(m) ? `${esc(d.advance)} проходит · ${d.h}:${d.a}` : `${esc(m.home)}–${esc(m.away)} ${d.h}:${d.a}`;
      toast(`<span class="k">✓</span> Ставка принята — ${lbl}`);
      refreshGo(); refreshMenuAndRail();
    } catch (err) {
      goBtn.innerHTML = prev; goBtn.disabled = false;
      const started = (err?.message || "").includes("начал");
      toast(started ? "⛔ Матч уже начался — ставка не принята" : "Ошибка, попробуй ещё");
    }
  });

  wireParticipants(el);
  // initial render from prefilled prediction
  if (d.h != null) renderN("h"); if (d.a != null) renderN("a");
  if (d.player) setPlayer(d.player);
  if (d.h != null && d.a != null) { ["o", "e"].forEach((s) => el.querySelector(`[data-pc="${s}"]`)?.classList.add("hit")); }
  updateAdvance(); refreshGo();
  if (d.placed && draftEl) { draftEl.classList.add("saved"); draftEl.innerHTML = '<span class="d"></span>сохранено · меняй до старта'; }
}

// ── Messi sheet (реальная AI-подсказка, prose) ───────────────────────────────
async function openMessi(m) {
  const chat = $("mchat"), sub = $("messiSub");
  sub.textContent = `${m.home} — ${m.away} · кого брать и на что ставить`;
  chat.innerHTML = '<div class="typing"><i></i><i></i><i></i></div>';
  document.body.classList.add("sheet-open");
  try {
    const res = await apiMatchHint(m.id);
    const hint = (res?.hint || "Месси задумался и промолчал 🤔").trim();
    const html = esc(hint).replace(/\n{2,}/g, "</div><div class='mline l2'>").replace(/\n/g, "<br>");
    chat.innerHTML = `<div class="mline">${html}</div>`;
  } catch (err) {
    const msg = (err?.message || "").toLowerCase();
    chat.innerHTML = `<div class="mline">${msg.includes("429") || msg.includes("много") ? "Слишком часто спрашиваешь 😅 дай Месси перевести дух — попробуй через пару минут." : "Месси сейчас занят (тренировка 🐐). Попробуй чуть позже."}</div>`;
  }
}

// ── casino mode (лёгкий вайб) ────────────────────────────────────────────────
let casino = false;
function toggleCasino() {
  casino = !casino; document.body.classList.toggle("casino", casino);
  if (casino) { toast("🎰 Режим казика — врубили"); rainCoins(); } else toast("казик выключен 😌");
}
function rainCoins() {
  const coins = ["🪙", "💰", "🎰", "⭐"];
  for (let i = 0; i < 18; i++) setTimeout(() => {
    if (!casino) return;
    const c = document.createElement("div"); c.className = "coin"; c.textContent = coins[i % coins.length];
    c.style.left = (Math.random() * 92 + 2) + "%"; c.style.animationDuration = (1.8 + Math.random() * 1.6) + "s";
    document.body.appendChild(c); setTimeout(() => c.remove(), 3600);
  }, i * 90);
}
function sparkle(card) {
  const r = card.getBoundingClientRect();
  for (let i = 0; i < 9; i++) { const c = document.createElement("div"); c.className = "coin"; c.textContent = "✨";
    c.style.left = (r.left + Math.random() * r.width) + "px"; c.style.top = (r.top + 18) + "px"; c.style.position = "fixed";
    c.style.animationDuration = (1 + Math.random() * 0.8) + "s"; c.style.fontSize = "16px";
    document.body.appendChild(c); setTimeout(() => c.remove(), 1800); }
}

// ── filters / feed render ────────────────────────────────────────────────────
const TITLES = { live: "В лайве прямо сейчас", today: "Матчи сегодня", all: "Все матчи" };
const SUBTITLES = { all: "Все матчи", future: "Будущие матчи", finished: "Завершённые матчи" };

function feedPool() {
  const seen = new Set();
  const pool = [];
  for (const m of activeMatches) { if (!seen.has(m.id)) { seen.add(m.id); pool.push(m); } }
  for (const m of FUTURE) { if (!seen.has(m.id)) { seen.add(m.id); pool.push(m); } }
  return pool.sort((a, b) => String(a.dateTimeRaw).localeCompare(String(b.dateTimeRaw)));
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
    else card = inActive ? buildUpcomingCard(m) : buildUpcomingCard(m);
    card.dataset.active = inActive ? "1" : "0";
    list.appendChild(card);
  }
  applyFilters();
}
function cardVisible(card) {
  const st = card.dataset.state, active = card.dataset.active === "1";
  if (curFilter === "live") return st === "live";
  if (curFilter === "today") return active && st !== "finished";
  if (curSub === "future") return st === "upcoming";
  if (curSub === "finished") return st === "finished";
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
  $("feedTitle").textContent = curFilter === "all" ? SUBTITLES[curSub] : TITLES[curFilter];
  const w = shown + " " + (shown === 1 ? "матч" : (shown >= 2 && shown <= 4 ? "матча" : "матчей"));
  $("feedCount").textContent = w;
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
  else { sub.classList.remove("show"); curSub = "all"; syncSub(); }
  applyFilters();
}
function setSub(s) { curSub = s; syncSub(); applyFilters(); }
function syncSub() { document.querySelectorAll("#subseg .subchip").forEach((b) => b.classList.toggle("on", b.dataset.s === curSub)); }
function defaultFilter() { return feedPool().some((m) => getMatchPhase(m) === "live") ? "live" : "today"; }

// ── bracket (реальные knockout-матчи по раундам) ─────────────────────────────
function renderBracket() {
  const wrap = $("bracket"); wrap.innerHTML = "";
  const rounds = [["R32", "1/16 финала"], ["R16", "1/8 финала"], ["QF", "1/4 финала"], ["SF", "1/2 финала"], ["F", "Финал"]];
  const pool = feedPool();
  let any = false; let myPO = 0;
  for (const [key, title] of rounds) {
    const ms = pool.filter((m) => classifyKnockoutRound(m.group) === key)
      .sort((a, b) => String(a.dateTimeRaw).localeCompare(String(b.dateTimeRaw)));
    if (!ms.length) continue;
    any = true;
    const col = document.createElement("div"); col.className = "bcol" + (key === "F" ? " fin" : "");
    const sp = stagePoints(ms[0].group);
    col.innerHTML = `<div class="ch"><span class="t">${title}</span><span class="bonus">+${sp.outcome}·+${sp.exact}·+${sp.player}</span></div>`;
    for (const m of ms) {
      const actual = resolveActualResult(m);
      const pred = currentUser?.matches?.[m.id];
      const mp = matchPointsFor(pred, m); myPO += mp.total;
      const win = actual?.winner;
      const cell = document.createElement("div");
      cell.className = "bcell" + (pred && mp.total > 0 ? " mine-hit" : "");
      const teamRow = (name, score) => `<div class="bteam${win && win === name ? " win" : ""}">${flagImg(name, "")}<span class="nm">${esc(name)}</span>` +
        (score != null ? `<span class="sc num">${score}</span>` : "") + `</div>`;
      cell.innerHTML = teamRow(m.home, actual ? actual.home : null) + teamRow(m.away, actual ? actual.away : null) +
        (pred && pred.home !== "" ? `<div class="picked">твоя ставка: ${esc(pred.home)}:${esc(pred.away)}${isKO(m) && predictedAdvance(pred, m) ? ` · проходит ${esc(predictedAdvance(pred, m))}` : ""}</div>` : "");
      col.appendChild(cell);
    }
    wrap.appendChild(col);
  }
  $("bkMine").textContent = "+" + myPO;
  if (!any) wrap.innerHTML = `<div class="empty" style="display:block">Плей-офф ещё не начался — сетка появится позже 🏆</div>`;
}

// ── profile ──────────────────────────────────────────────────────────────────
function renderProfile() {
  const st = myStanding();
  $("pfNick").textContent = currentUser.nickname;
  $("pfPts").textContent = st.pts;
  $("pfSub").textContent = `${st.pts} очков${st.rank ? ` · ${st.rank} место` : ""}`;
  const o = currentUser.outrights || {};
  const ao = state.actualOutrights || {};
  const eq = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const row = (ic, bg, lab, val, pts, hit) =>
    `<div class="row"><span class="av" style="background:${bg}">${ic}</span>` +
    `<span class="who">${lab}<small>${val ? esc(val) : "не выбран"}</small></span>` +
    `<span class="v" style="color:${val ? (hit ? "var(--accent)" : "var(--muted)") : "var(--dim)"}">${val ? (hit ? "+" + pts : "—") : "—"}</span></div>`;
  $("pfOutrights").innerHTML =
    row("🏆", "rgba(169,160,255,.15)", "Чемпион", o.winner, 8, eq(o.winner, ao.winner)) +
    row("⭐", "rgba(255,203,69,.15)", "Игрок турнира", o.bestPlayer, 8, eq(o.bestPlayer, ao.bestPlayer)) +
    row("🥅", "rgba(122,162,255,.15)", "Бомбардир", o.topScorer, 5, eq(o.topScorer, ao.topScorer)) +
    `<div class="row"><span class="av" style="background:rgba(46,226,122,.12)">✏️</span><span class="who">Долгосрочные меняются в старом разделе<small>тут — только просмотр</small></span></div>`;
}

// ── header / rail / menu ─────────────────────────────────────────────────────
function refreshMenuAndRail() {
  const st = myStanding();
  $("ptsVal").textContent = st.pts;
  // hero
  const hero = $("hero");
  hero.style.display = "flex";
  $("heroHi").innerHTML = `С возвращением, ${esc(currentUser.nickname)} 🫡`;
  $("heroRank").textContent = st.rank || "–";
  const list = sortedUsers();
  if (st.rank && st.rank > 5) {
    const gap = list[4] ? list[4].pts - st.pts : 0;
    $("heroSub").textContent = gap > 0 ? `До топ-5 — ${gap} очков 👀` : "Ты в топе 🔥";
  } else $("heroSub").textContent = st.rank ? "Ты в топ-5 🔥" : "Сделай первую ставку 👇";
  // rail leaderboard: top-5 + me
  const rail = $("railLb");
  const top = list.slice(0, 5);
  const rows = top.map((x, i) => lbRow(i + 1, x));
  if (st.rank && st.rank > 5) rows.push(lbRow(st.rank, list[st.rank - 1]));
  rail.innerHTML = rows.join("");
  // live dot in menu
  const anyLive = feedPool().some((m) => getMatchPhase(m) === "live");
  $("menuLiveDot").style.display = anyLive ? "" : "none";
  $("ticker").style.display = anyLive ? "" : "none";
  if (anyLive) renderTicker();
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
  if (!items.length) { tk.innerHTML = ""; return; }
  tk.innerHTML = (items.join("") + items.join("")); // дубль для бесшовной прокрутки
}

// ── nav ──────────────────────────────────────────────────────────────────────
function closeAll() { document.body.classList.remove("menu-open", "sheet-open"); }
function showView(vid) { document.querySelectorAll(".view").forEach((x) => x.classList.toggle("on", x.id === vid)); }
function setMenuActive(v) { document.querySelectorAll(".menu .mi").forEach((mi) => mi.classList.toggle("on", mi.dataset.v === v)); }
function go(v) {
  closeAll();
  if (v === "old") { window.location.href = "/"; return; }
  if (v === "live") { showView("view-feed"); setFilter("live"); setMenuActive("feed"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (v === "bracket") { showView("view-bracket"); renderBracket(); setMenuActive("bracket"); }
  else if (v === "prof") { showView("view-prof"); renderProfile(); setMenuActive("prof"); }
  else { showView("view-feed"); setFilter(defaultFilter()); setMenuActive("feed"); }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function wireChrome() {
  $("burger").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  $("scrim").addEventListener("click", closeAll);
  $("logo").addEventListener("click", toggleCasino);
  $("casinoBtn").addEventListener("click", () => { toggleCasino(); closeAll(); });
  $("ptsBtn").addEventListener("click", () => go("prof"));
  document.querySelectorAll(".menu .mi[data-v]").forEach((mi) => mi.addEventListener("click", () => go(mi.dataset.v)));
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $("seg").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.f)));
  $("subseg").querySelectorAll(".subchip").forEach((b) => b.addEventListener("click", () => setSub(b.dataset.s)));
  $("searchInput").addEventListener("input", applyFilters);
  window.addEventListener("resize", movePill);
}

// ── boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  // Гейт — на сервере (роут /v3 пускает только Тиму). Здесь лишь defence-in-depth:
  // без сессии уходим в старый раздел.
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
  curFilter = defaultFilter();
  renderFeed();
  refreshMenuAndRail();
  setTimeout(movePill, 100);
}

boot();
