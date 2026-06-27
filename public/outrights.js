import { state, currentUser, emptyOutrights, DARK_HORSE_TEAMS } from "./store.js";
import { $, escapeHtml, canEditOutrights, formatDeadline, parseDarkHorse } from "./utils.js";
import { renderScoreboard } from "./scoreboard.js";
import { apiSaveOutrights, apiSaveActualOutrights } from "./api-client.js";
import { createTeamSelector, createPlayerSelector } from "./wc-selector.js";

// ── Dark horse chip selector ─────────────────────────────────────────────────

export function createDarkHorseSelector(container, onChange, currentVal = null, disabled = false) {
  let selected = parseDarkHorse(currentVal);

  function render() {
    container.innerHTML = "";

    const counter = document.createElement("p");
    counter.className = "dh-counter muted small";
    const done = selected.length === 3;
    counter.textContent = done ? "Выбрано 3 из 3 ✓" : `Выбрано: ${selected.length} / 3`;
    counter.style.color = done ? "var(--accent)" : "";
    container.appendChild(counter);

    const chips = document.createElement("div");
    chips.className = "dh-chips";

    DARK_HORSE_TEAMS.forEach((team) => {
      const on   = selected.includes(team);
      const full = !on && selected.length >= 3;
      const btn  = document.createElement("button");
      btn.type = "button";
      btn.className = `dh-chip${on ? " dh-chip--on" : ""}${full ? " dh-chip--dim" : ""}`;
      btn.textContent = team;
      btn.disabled = disabled || full;

      if (!disabled) {
        btn.addEventListener("click", () => {
          if (on) {
            selected = selected.filter((t) => t !== team);
          } else if (selected.length < 3) {
            selected = [...selected, team];
          }
          render();
          onChange([...selected]);
        });
      }
      chips.appendChild(btn);
    });
    container.appendChild(chips);
  }

  render();
  return () => [...selected];
}

// ── Module-level getters (survive re-renders) ────────────────────────────────
let _mainDHGetter      = () => [];
let _mainWinnerGetter  = () => "";
let _mainBPGetter      = () => "";
let _mainTSGetter      = () => "";

let _actualDHGetter      = () => [];
let _actualWinnerGetter  = () => "";
let _actualBPGetter      = () => "";
let _actualTSGetter      = () => "";

// ── Render user's own outrights display ──────────────────────────────────────
export function renderOutrightsSection() {
  const o       = currentUser.outrights || emptyOutrights();
  const display = $("outrights-display");
  const hint    = $("outrights-deadline-hint");
  const editBtn = $("edit-outrights-btn");
  const form    = $("main-outrights-form");

  const dhTeams = parseDarkHorse(o.darkHorse);
  const dhText  = dhTeams.length ? dhTeams.join(", ") : "—";

  display.innerHTML = `
    <div class="outrights-item"><span class="label">Победитель ЧМ</span><span class="value">${escapeHtml(o.winner)}</span></div>
    <div class="outrights-item"><span class="label">Лучший игрок</span><span class="value">${escapeHtml(o.bestPlayer)}</span></div>
    <div class="outrights-item"><span class="label">Лучший бомбардир</span><span class="value">${escapeHtml(o.topScorer)}</span></div>
    <div class="outrights-item"><span class="label">Уёбищные команды</span><span class="value">${escapeHtml(dhText)}</span></div>
  `;

  if (canEditOutrights()) {
    hint.textContent = `Можно изменить до ${formatDeadline()} включительно.`;
    editBtn.classList.remove("hidden");
  } else {
    hint.textContent = `Редактирование закрыто с ${formatDeadline()}.`;
    editBtn.classList.add("hidden");
    form.classList.add("hidden");
    display.classList.remove("hidden");
  }
}

// ── Main outrights edit form ──────────────────────────────────────────────────
export function setupMainOutrightsForm() {
  const editBtn = $("edit-outrights-btn");
  const form    = $("main-outrights-form");
  const display = $("outrights-display");

  editBtn.addEventListener("click", () => {
    if (!canEditOutrights()) return;
    const o = currentUser.outrights || emptyOutrights();

    _mainWinnerGetter = createTeamSelector($("main-winner-selector"),   () => {}, o.winner);
    _mainBPGetter     = createPlayerSelector($("main-bp-selector"),     () => {}, o.bestPlayer);
    _mainTSGetter     = createPlayerSelector($("main-ts-selector"),     () => {}, o.topScorer);

    const dhContainer = $("main-dark-horse-selector");
    _mainDHGetter = createDarkHorseSelector(dhContainer, () => {}, o.darkHorse);

    display.classList.add("hidden");
    editBtn.classList.add("hidden");
    form.classList.remove("hidden");
  });

  $("cancel-outrights-btn").addEventListener("click", () => {
    form.classList.add("hidden");
    display.classList.remove("hidden");
    if (canEditOutrights()) editBtn.classList.remove("hidden");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canEditOutrights() || !currentUser) return;

    const dhPicks = _mainDHGetter();
    if (dhPicks.length < 3) {
      alert("Выбери ровно 3 уёбищные команды.");
      return;
    }
    const winner     = _mainWinnerGetter().trim();
    const bestPlayer = _mainBPGetter().trim();
    const topScorer  = _mainTSGetter().trim();
    if (!winner || !bestPlayer || !topScorer) {
      alert("Заполните все поля.");
      return;
    }

    const outrights = {
      winner,
      bestPlayer,
      topScorer,
      darkHorse: JSON.stringify(dhPicks),
    };

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await apiSaveOutrights(outrights);
      currentUser.outrights = outrights;
      form.classList.add("hidden");
      display.classList.remove("hidden");
      if (canEditOutrights()) editBtn.classList.remove("hidden");
      renderOutrightsSection();
      renderScoreboard();
    } catch (err) {
      console.error("Failed to save outrights:", err);
    } finally {
      btn.disabled = false;
    }
  });
}

// ── Admin: actual outrights ───────────────────────────────────────────────────
export function renderActualOutrights() {
  const o = state.actualOutrights || emptyOutrights();

  const wc = $("actual-winner-selector");
  if (wc) _actualWinnerGetter = createTeamSelector(wc, () => {}, o.winner || "");

  const bpc = $("actual-bp-selector");
  if (bpc) _actualBPGetter = createPlayerSelector(bpc, () => {}, o.bestPlayer || "");

  const tsc = $("actual-ts-selector");
  if (tsc) _actualTSGetter = createPlayerSelector(tsc, () => {}, o.topScorer || "");

  const dhContainer = $("actual-dark-horse-selector");
  if (dhContainer) {
    _actualDHGetter = createDarkHorseSelector(dhContainer, () => {}, o.darkHorse);
  }
}

export function setupAdmin() {
  $("recalculate-btn")?.addEventListener("click", renderScoreboard);

  $("actual-outrights-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const dhPicks = _actualDHGetter();
    if (dhPicks.length < 3) {
      alert("Выбери ровно 3 команды-тёмные лошадки.");
      return;
    }

    const data = {
      winner:     _actualWinnerGetter().trim(),
      bestPlayer: _actualBPGetter().trim(),
      topScorer:  _actualTSGetter().trim(),
      darkHorse:  JSON.stringify(dhPicks),
    };
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await apiSaveActualOutrights(data);
      state.actualOutrights = data;
      renderScoreboard();
    } catch (err) {
      console.error("Failed to save actual outrights:", err);
    } finally {
      btn.disabled = false;
    }
  });
}

// ── All-outrights public table (shown after deadline) ────────────────────────
export function renderAllOutrights() {
  const section = $("all-outrights-section");
  const list    = $("all-outrights-list");
  if (!section || !list) return;
  if (canEditOutrights() || !state.users?.length) { section.classList.add("hidden"); return; }

  section.classList.remove("hidden");

  const ao  = state.actualOutrights || {};
  const eq  = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const actualDH = parseDarkHorse(ao.darkHorse);

  const rows = state.users.map((u) => {
    const o      = u.outrights || emptyOutrights();
    const playerDH = parseDarkHorse(o.darkHorse);
    const dhCells  = playerDH.map((t) => {
      const hit = actualDH.some((a) => eq(a, t));
      return `<span class="${hit ? "check-correct" : ""}">${escapeHtml(t)}</span>`;
    }).join(" · ") || "—";

    return `<tr>
      <td>${escapeHtml(u.nickname)}</td>
      <td class="${eq(o.winner,     ao.winner)     ? "check-correct" : ""}">${escapeHtml(o.winner     || "—")}</td>
      <td class="${eq(o.bestPlayer, ao.bestPlayer) ? "check-correct" : ""}">${escapeHtml(o.bestPlayer || "—")}</td>
      <td class="${eq(o.topScorer,  ao.topScorer)  ? "check-correct" : ""}">${escapeHtml(o.topScorer  || "—")}</td>
      <td>${dhCells}</td>
    </tr>`;
  }).join("");

  list.innerHTML = `
    <div class="admin-table-wrapper" style="margin-top:10px">
      <table class="admin-table">
        <thead><tr>
          <th>Участник</th><th>Победитель (+8)</th><th>Лучший игрок (+8)</th>
          <th>Бомбардир (+5)</th><th>Уёбищные (3×+3)</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
