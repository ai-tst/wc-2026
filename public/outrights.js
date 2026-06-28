import { state, currentUser, emptyOutrights, DARK_HORSE_TEAMS } from "./store.js";
import { $, escapeHtml, canEditOutrights, formatDeadline, parseDarkHorse } from "./utils.js";
import { renderScoreboard } from "./scoreboard.js";
import { apiSaveOutrights, apiSaveActualOutrights } from "./api-client.js";
import { createTeamSelector, createPlayerSelector } from "./wc-selector.js";
import { getUserTotalPoints } from "./points.js";

// Russian WC team name → ISO flag code (for flag-icons), used in v2 outrights.
const RU_TEAM_FLAGS = {
  "Австралия":"au","Австрия":"at","Англия":"gb-eng","Аргентина":"ar","Бельгия":"be",
  "Бразилия":"br","Германия":"de","Испания":"es","Колумбия":"co","Марокко":"ma",
  "Мексика":"mx","Нидерланды":"nl","Норвегия":"no","Португалия":"pt","США":"us",
  "Уругвай":"uy","Франция":"fr","Хорватия":"hr","Швейцария":"ch","Швеция":"se",
  "Южная Корея":"kr","Япония":"jp","Алжир":"dz","Босния и Герцеговина":"ba","Гаити":"ht",
  "Гана":"gh","ДР Конго":"cd","Египет":"eg","Иордания":"jo","Иран":"ir","Ирак":"iq",
  "Кабо-Верде":"cv","Канада":"ca","Катар":"qa","Кот-д'Ивуар":"ci","Кюрасао":"cw",
  "Новая Зеландия":"nz","Панама":"pa","Парагвай":"py","Саудовская Аравия":"sa","Сенегал":"sn",
  "Тунис":"tn","Турция":"tr","Узбекистан":"uz","Чехия":"cz","Шотландия":"gb-sct",
  "Эквадор":"ec","ЮАР":"za",
};
function ruFlag(name) {
  const code = RU_TEAM_FLAGS[(name || "").trim()];
  return code ? `<span class="fi fi-${code} team-flag"></span>` : "";
}
const isV2 = () => currentUser?.designVersion === "v2";

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
// Понятное пояснение по коэффициентам — рядом с долгосрочными ставками (OTS-20).
// Один источник правды по очкам: лонгтерм + база за матч + честный бонус плей-офф.
function rulesNoteHtml() {
  return `
    <details class="rules-note">
      <summary class="rules-note__sum">ℹ️ Как начисляются очки</summary>
      <div class="rules-note__body">
        <div class="rules-note__group">
          <span class="rules-note__title">Долгосрочные (ставишь один раз, до старта)</span>
          <ul>
            <li>Чемпион ЧМ — <b>+8</b></li>
            <li>Лучший игрок турнира — <b>+8</b></li>
            <li>Лучший бомбардир — <b>+5</b></li>
            <li>Уёбищные команды — <b>+3</b> за каждую угаданную (3 шт., макс +9)</li>
          </ul>
        </div>
        <div class="rules-note__group">
          <span class="rules-note__title">За каждый матч</span>
          <ul>
            <li>Угадал исход — <b>+1</b></li>
            <li>Точный счёт — <b>+3</b></li>
            <li>Лучший игрок матча — <b>+2</b></li>
          </ul>
        </div>
        <div class="rules-note__group">
          <span class="rules-note__title">Плей-офф — бонус сверху, чем глубже, тем жирнее</span>
          <ul>
            <li>1/16 — исход <b>+1</b> · точный <b>+2</b> · игрок <b>+1</b></li>
            <li>1/8 — исход <b>+1</b> · точный <b>+2</b> · игрок <b>+1</b></li>
            <li>1/4 — исход <b>+2</b> · точный <b>+3</b> · игрок <b>+2</b></li>
            <li>1/2 — исход <b>+2</b> · точный <b>+3</b> · игрок <b>+2</b></li>
            <li>Финал — исход <b>+3</b> · точный <b>+4</b> · игрок <b>+3</b></li>
          </ul>
          <p class="rules-note__why">«Исход» в плей-офф — это кто прошёл дальше (хоть по пенальти). А точный счёт считается строго по основному времени — 90 минут, без дополнительного времени и без серии пенальти. Бонус идёт сверху базовых очков и растёт от раунда к раунду: ранние раунды берут массой матчей, а к финалу каждый матч жирнее.</p>
        </div>
      </div>
    </details>`;
}

export function renderOutrightsSection() {
  const o       = currentUser.outrights || emptyOutrights();
  const display = $("outrights-display");
  const hint    = $("outrights-deadline-hint");
  const editBtn = $("edit-outrights-btn");
  const form    = $("main-outrights-form");

  const dhTeams = parseDarkHorse(o.darkHorse);
  const dhText  = dhTeams.length ? dhTeams.join(", ") : "—";

  const h2 = document.querySelector(".card--outrights h2");
  if (isV2()) {
    if (h2) h2.textContent = "Долгосрочные ставки";
    const winnerHtml = (o.winner ? ruFlag(o.winner) : "") + escapeHtml(o.winner || "—");
    const dhHtml = dhTeams.length
      ? dhTeams.map((t) => `<span class="oc-dh">${ruFlag(t)}${escapeHtml(t)}</span>`).join("")
      : "—";
    display.innerHTML = `
      <div class="oc-mine-label">Твоя</div>
      <div class="outrights-compact">
        <span class="oc-item"><span class="oc-label">Чемпион</span>${winnerHtml}</span>
        <span class="oc-item"><span class="oc-label">Лучший игрок</span>${escapeHtml(o.bestPlayer || "—")}</span>
        <span class="oc-item"><span class="oc-label">Бомбардир</span>${escapeHtml(o.topScorer || "—")}</span>
        <span class="oc-item oc-item--dh"><span class="oc-label">Уёбищные</span><span class="oc-dh-list">${dhHtml}</span></span>
      </div>`;
  } else {
    if (h2) h2.textContent = "Ваши долгосрочные ставки";
    display.innerHTML = `
      <div class="outrights-item"><span class="label">Победитель ЧМ</span><span class="value">${escapeHtml(o.winner)}</span></div>
      <div class="outrights-item"><span class="label">Лучший игрок</span><span class="value">${escapeHtml(o.bestPlayer)}</span></div>
      <div class="outrights-item"><span class="label">Лучший бомбардир</span><span class="value">${escapeHtml(o.topScorer)}</span></div>
      <div class="outrights-item"><span class="label">Уёбищные команды</span><span class="value">${escapeHtml(dhText)}</span></div>
    `;
  }

  const rules = $("outrights-rules");
  if (rules) rules.innerHTML = isV2() ? rulesNoteHtml() : "";

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
  const section = $("all-outrights-section");   // v1: bottom of page (all users)
  const list    = $("all-outrights-list");
  const block   = $("outrights-others-block");  // v2: collapsible under your picks (others only)
  const olist   = $("outrights-others-list");

  const hideAll = () => { section?.classList.add("hidden"); block?.classList.add("hidden"); };
  if (!section && !block) return;
  if (canEditOutrights() || !state.users?.length) { hideAll(); return; }

  const ao  = state.actualOutrights || {};
  const eq  = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const actualDH = parseDarkHorse(ao.darkHorse);

  const rowFor = (u) => {
    const o        = u.outrights || emptyOutrights();
    const playerDH = parseDarkHorse(o.darkHorse);
    const dhCells  = playerDH.map((t) => {
      const hit = actualDH.some((a) => eq(a, t));
      return `<span class="${hit ? "check-correct" : ""}" style="white-space:nowrap">${ruFlag(t)}${escapeHtml(t)}</span>`;
    }).join(" · ") || "—";
    return `<tr>
      <td>${escapeHtml(u.nickname)}</td>
      <td class="${eq(o.winner,     ao.winner)     ? "check-correct" : ""}">${o.winner ? ruFlag(o.winner) : ""}${escapeHtml(o.winner || "—")}</td>
      <td class="${eq(o.bestPlayer, ao.bestPlayer) ? "check-correct" : ""}">${escapeHtml(o.bestPlayer || "—")}</td>
      <td class="${eq(o.topScorer,  ao.topScorer)  ? "check-correct" : ""}">${escapeHtml(o.topScorer  || "—")}</td>
      <td>${dhCells}</td>
    </tr>`;
  };

  const table = (users) => `
    <div class="admin-table-wrapper" style="margin-top:10px">
      <table class="admin-table">
        <thead><tr>
          <th>Участник</th><th>Победитель (+8)</th><th>Лучший игрок (+8)</th>
          <th>Бомбардир (+5)</th><th>Уёбищные (3×+3)</th>
        </tr></thead>
        <tbody>${users.map(rowFor).join("")}</tbody>
      </table>
    </div>`;

  // Order participants by leaderboard rank (most points first)
  const sorted = [...state.users].sort((a, b) => getUserTotalPoints(b) - getUserTotalPoints(a));
  // v1 bottom table shows everyone
  if (section && list) { section.classList.remove("hidden"); list.innerHTML = table(sorted); }
  // v2 in-card collapsible shows OTHERS, ordered by leaderboard rank
  if (block && olist) {
    const others = sorted.filter((u) => u.nickname !== currentUser?.nickname);
    block.classList.remove("hidden");
    olist.innerHTML = table(others);
  }
}
