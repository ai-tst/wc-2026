import {
  state, currentUser, setCurrentUser,
  activeMatches, fixturesLoaded,
  setFixturesLoaded, setActiveMatches,
  setMatchesDegraded,
  emptyOutrights, updateStateFromServer,
} from "./store.js";
import { $ } from "./utils.js";
import { setupAuth }       from "./auth.js";
import { setupOnboarding } from "./onboarding.js";
import {
  renderOutrightsSection, setupMainOutrightsForm,
  renderActualOutrights,  setupAdmin, renderAllOutrights,
} from "./outrights.js";
import { renderMatches, renderMatchResults, renderPlayerProfile } from "./matches.js";
import { renderScoreboard } from "./scoreboard.js";
import { renderStats } from "./stats.js";
import { renderBracket } from "./bracket.js";
import { setupCasino } from "./casino.js";
import { fetchMatchesFromSportDb } from "./api.js";
import {
  apiMe, apiGetPredictions, apiGetOutrights, apiGetLeaderboard,
  apiSetDesignVersion,
} from "./api-client.js";

// ── Mock data ────────────────────────────────────────────────────────────────
const MOCK_MATCHES = [
  { id:"mock-1", home:"France",  away:"Brazil",    homeTeamId:"", awayTeamId:"",
    status:2, homeScore:null, awayScore:null,
    time:"18:00", date:"mock", dateTimeRaw:"2026-06-11T18:00:00Z",
    group:"Group A", league:"Mock", odds:{home:2.10,draw:3.40,away:3.20} },
  { id:"mock-2", home:"Germany", away:"Argentina", homeTeamId:"", awayTeamId:"",
    status:5, homeScore:1, awayScore:0,
    time:"21:00", date:"mock", dateTimeRaw:"2026-06-11T21:00:00Z",
    group:"Group B", league:"Mock", odds:{home:2.50,draw:3.10,away:2.90} },
  { id:"mock-3", home:"Spain",   away:"England",   homeTeamId:"", awayTeamId:"",
    status:9, homeScore:2, awayScore:1,
    time:"15:00", date:"mock", dateTimeRaw:"2026-06-11T15:00:00Z",
    group:"Group C", league:"Mock", odds:{home:2.30,draw:3.20,away:3.10} },
];

// ── Views ────────────────────────────────────────────────────────────────────
function showView(name) {
  ["view-auth", "view-onboarding", "view-main", "view-player-profile", "view-bracket"].forEach((id) => {
    const el = $(id);
    if (el) el.classList.toggle("hidden", id !== name);
  });
  // bracket wants the full monitor width (more columns than the capped layout)
  document.body.classList.toggle("bracket-open", name === "view-bracket");
}

// ── Match loading ─────────────────────────────────────────────────────────────
async function loadMatches(dateOverride) {
  setFixturesLoaded(true);
  try {
    const result = await fetchMatchesFromSportDb(dateOverride);
    setActiveMatches(result.matches || []);
    setMatchesDegraded(!!result.degraded);
    console.info("[API] Loaded fixtures:", result.matches);
  } catch (err) {
    console.error("[API] Failed to load matches:", err);
    setActiveMatches([]);
    setMatchesDegraded(true);   // совсем не дотянулись до бэка → данные точно неполные
  }
  renderMatches();
  renderMatchResults();
  renderScoreboard();
  renderStats();
  scheduleRefreshIfLive();
  applyMatchDeepLink();
}

// ── Deep link (?match=<id>) — прыжок прямо на карточку ставки (пинг из бота) ────
let pendingMatchDeepLink = new URLSearchParams(location.search).get("match");

function clearMatchDeepLink() {
  pendingMatchDeepLink = null;
  const url = new URL(location.href);
  url.searchParams.delete("match");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

function showDeepLinkMiss() {
  document.querySelector(".deeplink-miss")?.remove();
  const el = document.createElement("div");
  el.className = "deeplink-miss";
  el.textContent = "Этот матч сейчас недоступен для ставки 🤷 Лови остальные ниже";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function applyMatchDeepLink() {
  if (!pendingMatchDeepLink) return;
  const el = document.getElementById("match-" + pendingMatchDeepLink);
  if (!el) {
    // Карточки ещё не отрисованы — ждём; сдаёмся, только когда матчи уже загружены
    // (значит, на этот матч ставки закрыты/он не в списке). OTS-52: не молчим в
    // пустоту, а показываем понятную заглушку — пуш вёл на матч, которого тут нет.
    if (fixturesLoaded) {
      showDeepLinkMiss();
      clearMatchDeepLink();
    }
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("match-row--highlight");
  setTimeout(() => el.classList.remove("match-row--highlight"), 2600);
  const firstInput = el.querySelector("input");
  if (firstInput && !firstInput.disabled) setTimeout(() => firstInput.focus(), 400);
  clearMatchDeepLink();
}

async function ensureMatchesLoaded() {
  if (fixturesLoaded) return;
  await loadMatches();
}

function scheduleRefreshIfLive() {
  const hasLive = activeMatches.some((m) => { const s=Number(m.status); return s>=3&&s<=7; });
  if (hasLive) setTimeout(() => loadMatches(), 60_000);
}

function loadMockData() {
  setFixturesLoaded(true);
  setActiveMatches([...MOCK_MATCHES]);
  renderMatches();
  renderScoreboard();
}

// ── Leaderboard refresh ───────────────────────────────────────────────────────
async function refreshLeaderboard() {
  try {
    const data = await apiGetLeaderboard();
    updateStateFromServer(data);
    renderMatches();       // re-render to show all participants' bets on live/ended matches
    renderMatchResults();
    renderScoreboard();
    renderStats();
    renderAllOutrights();
    if (currentUser?.isAdmin) {
      renderActualOutrights();
      renderAdminPlayers();
    }
    applyMatchDeepLink();
  } catch (err) {
    console.error("[Leaderboard] Failed to load:", err);
  }
}

// ── Test controls ─────────────────────────────────────────────────────────────
function setupTestControls() {
  const mockBtn   = $("load-mock-btn");
  const dateInput = $("test-date-input");
  const reloadBtn = $("reload-date-btn");

  mockBtn?.addEventListener("click", () => {
    loadMockData();
    if (dateInput) dateInput.value = "";
  });

  reloadBtn?.addEventListener("click", () => {
    const date = dateInput?.value || undefined;
    setFixturesLoaded(false);
    loadMatches(date);
  });
}

// ── Admin panel ───────────────────────────────────────────────────────────────
function renderAdminPlayers() {
  const container = $("admin-players-list");
  if (!container) return;

  const esc = (s) => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  if (!state.users.length) {
    container.innerHTML = `<p class="muted small">Участников пока нет.</p>`;
    return;
  }

  const parseDH = (val) => {
    if (!val) return [];
    try { const p = JSON.parse(val); return Array.isArray(p) ? p : [val]; } catch { return [val]; }
  };

  const rows = state.users.map((u) => {
    const o  = u.outrights || {};
    const ao = state.actualOutrights || {};
    const eq = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();

    const checkWin = eq(o.winner,     ao.winner)     ? "✓" : "";
    const checkBp  = eq(o.bestPlayer, ao.bestPlayer) ? "✓" : "";
    const checkTs  = eq(o.topScorer,  ao.topScorer)  ? "✓" : "";

    const playerDH = parseDH(o.darkHorse);
    const actualDH = parseDH(ao.darkHorse);
    const dhHits   = playerDH.filter((t) => actualDH.some((a) => eq(a, t))).length;
    const dhText   = playerDH.map((t) =>
      `<span class="${actualDH.some((a) => eq(a, t)) ? "admin-check" : ""}">${esc(t)}</span>`
    ).join(" · ") || "—";

    return `<tr>
      <td>${esc(u.nickname)}</td>
      <td>${esc(o.winner)}     <span class="admin-check">${checkWin}</span></td>
      <td>${esc(o.bestPlayer)} <span class="admin-check">${checkBp}</span></td>
      <td>${esc(o.topScorer)}  <span class="admin-check">${checkTs}</span></td>
      <td>${dhText}${dhHits > 0 ? ` <span class="admin-check">(${dhHits}✓)</span>` : ""}</td>
    </tr>`;
  }).join("");

  container.innerHTML = `
    <div class="admin-table-wrapper">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Участник</th>
            <th>Победитель (+8)</th>
            <th>Лучший игрок (+8)</th>
            <th>Бомбардир (+5)</th>
            <th>Уёбищные (3×+3)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function updateAdminVisibility() {
  const panel = $("admin-panel");
  if (!panel) return;
  if (currentUser?.isAdmin) {
    panel.classList.remove("hidden");
    renderActualOutrights();
    renderAdminPlayers();
  } else {
    panel.classList.add("hidden");
  }
}

// ── Main page ─────────────────────────────────────────────────────────────────
function renderMainPage() {
  $("main-nickname").textContent = currentUser.nickname;
  renderOutrightsSection();
  renderMatches();
  renderMatchResults();
  renderScoreboard();
  renderAllOutrights();
  updateAdminVisibility();
  // async updates in parallel
  refreshLeaderboard();
  ensureMatchesLoaded();
}

// ── Route — async, reads session from server ──────────────────────────────────
async function route() {
  let userData;
  try {
    userData = await apiMe();
  } catch {
    userData = null;
  }

  if (!userData) {
    setCurrentUser(null);
    showView("view-auth");
    return;
  }

  // Load this user's data in parallel
  const [predictions, outrights] = await Promise.all([
    apiGetPredictions().catch(() => ({})),
    apiGetOutrights().catch(() => emptyOutrights()),
  ]);

  setCurrentUser({ ...userData, matches: predictions, outrights });
  applyDesign();

  if (!currentUser.onboardingComplete) {
    $("onboarding-nickname").textContent = currentUser.nickname;
    showView("view-onboarding");
    return;
  }

  showView("view-main");
  renderMainPage();
}

document.addEventListener("DOMContentLoaded", async () => {
  setupAuth(route);
  setupOnboarding(route);
  setupMainOutrightsForm();
  setupAdmin();
  setupTestControls();
  setupResultsToggle();
  setupPlayerProfile();
  setupDesignToggle();
  setupBracket();
  setupCasino();
  await route();
});

// ── Playoff bracket view ──────────────────────────────────────────────────────
function setupBracket() {
  $("bracket-btn")?.addEventListener("click", () => {
    showView("view-bracket");
    renderBracket();
  });
  $("bracket-back-btn")?.addEventListener("click", () => showView("view-main"));
}

// ── Design v1/v2 toggle ───────────────────────────────────────────────────────
function applyDesign() {
  const v2 = currentUser?.designVersion === "v2";
  document.body.classList.toggle("design-v2", v2);
  const btn = $("design-toggle-btn");
  if (btn) btn.textContent = v2 ? "↩ Старый дизайн" : "✨ Новый дизайн";
}

function setupDesignToggle() {
  const btn = $("design-toggle-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!currentUser) return;
    const next = currentUser.designVersion === "v2" ? "v1" : "v2";
    btn.disabled = true;
    btn.textContent = "…";
    // Persist, then hard-reload so the new design applies cleanly (no half-applied styles)
    try { await apiSetDesignVersion(next); }
    catch (err) { console.error("[design] save failed:", err); }
    location.reload();
  });
}

function setupResultsToggle() {
  const btn  = $("toggle-results-btn");
  const list = $("match-results-list");
  if (!btn || !list) return;
  btn.addEventListener("click", () => {
    const collapsed = list.classList.toggle("results-collapsed");
    btn.textContent = collapsed ? "▼" : "▲";
  });
}

function setupPlayerProfile() {
  $("profile-back-btn")?.addEventListener("click", () => showView("view-main"));

  // Event delegation — scoreboard nickname buttons (playoff + group tables)
  async function handleScoreboardClick(e) {
    const btn = e.target.closest("[data-player-nick]");
    if (!btn) return;
    const nick = btn.dataset.playerNick;
    $("profile-nickname").textContent = nick;
    const container = $("profile-match-list");
    container.innerHTML = `<p class="muted small">Загружаю...</p>`;
    showView("view-player-profile");
    await renderPlayerProfile(nick, container);
  }
  $("scoreboard-playoff-body")?.addEventListener("click", handleScoreboardClick);
  $("scoreboard-body")?.addEventListener("click", handleScoreboardClick);
}
