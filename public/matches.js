import { state, currentUser, activeMatches, matchesDegraded, futureMatches, showAllFuture, setShowAllFuture } from "./store.js";
import { $, escapeHtml } from "./utils.js";
import { getTeamPlayers } from "./api.js";
import { renderScoreboard } from "./scoreboard.js";
import { calculatePointsForMatch, resolveActualResult, matchPointsFor, classifyKnockoutRound, predictedAdvance, isMatchResultFinal, getMatchPhase, buildTodayMatches } from "./points.js";
import { apiSavePrediction, apiSaveActualMatch, apiGetMatchRatings, apiMatchHint } from "./api-client.js";
import { runScoreSlot } from "./casino.js";
import { openShareCard } from "./share-card.js";

const ERROR_MSG = "Да отсоси ты хуй бля";

// Новый дизайн — единственный, всегда активен.
function isV2() {
  return true;
}

// Short vibey word shown next to a player's points (for laughs among friends).
// Deterministic per (match+nick) so it stays put across re-renders.
const VIBES = {
  // +5 — точный счёт + лучший игрок (максимум). Превосходные / хайповые.
  top: [
    "имба","красава","гений","машина","легенда","монстр","читер","ванга","оракул","маэстро",
    "снайпер","король","элита","шедевр","пушка","бомба","ракета","космос","гигачад","сигма",
    "большой мозг","это база","галактикос","гол в девятку","сухой лист","магнус прогнозов","оскар за прогноз",
    "роналду одобряет","мбаппе плачет","вар не нужен","красава бро","топ-1 планета","имба полная",
    "идеально брат","ну ты голова","феномен","титан","абсолют","нострадамус","профессор",
    "чистый голеадор","хет-трик мозга","эйнштейн ставок","это голд","снято в печать","5 из 5",
    "бог прогнозов","банкомат очков","сам бы не смог","роналдиньо вайб",
  ],
  // +3
  good: [
    "шаришь","огонь","могёшь","база","респект","неплохо","достойно","чётко","молодец","умница",
    "годнота","кайф","смак","сочно","мощно","дерзко","толково","грамотно","хорош","силён",
    "орёл","ферзь","спец","знаток","зачёт","класс","супер","отлично","на классе","по красоте",
    "в касание","уверенно","солидно","смекалочка","хорош бро","плюсую","вин","так держать","молоток","по уму",
    "недурно","браво","крепкий мид","годный прогноз","лайк","ферзевый ход","почти топ","на стиле","делает дело","заряд",
  ],
  // +1..2
  ok: [
    "норм","сойдёт","чутка","нормас","окей","ладно","пойдёт","скромно","бывает","такое",
    "средне","слегка","впритык","рандом","наугад","фартануло","повезло","частично","негусто","минимум",
    "бедновато","кое-как","сносно","терпимо","ничё так","мелочь","копейки","так себе","на тоненького","чисто на фарте",
    "могло быть лучше","ну такое","проскочил","краем глаза","почти мимо","капля в море","еле-еле","норм бро","и так пойдёт","мид",
    "ниже среднего","на сдачу","ни рыба ни мясо","повезло чуток","серединка","чуток есть","выжал минимум","прокатило","сыграл в плюс","ну ок",
  ],
  // 0 — позор/роаст (сайт «Отсос!», так что можно поострее)
  zero: [
    "кринж","лох","мимо","позор","днище","соси","дно","лошара","провал","фиаско",
    "фейл","мисс","промах","пусто","голяк","слабак","бомж","рукожоп","криворукий","бездарь",
    "профан","ноунейм","клоун","цирк","грустно","боль","рип","капут","труп","мда",
    "кек","зеро","шляпа","мусор","трэш","кринжанул","тильт","баран","соснул","всё мимо",
    "в молоко","автогол мозга","сел в лужу","скилл ишью","минус рейтинг","ну ты дно","штанга мимо","мяч круглый брат","позор семьи","вернись в дворовый",
  ],
};
function vibeWord(pts, seed) {
  const arr = pts >= 5 ? VIBES.top : pts >= 3 ? VIBES.good : pts >= 1 ? VIBES.ok : VIBES.zero;
  let h = 0; const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return arr[Math.abs(h) % arr.length];
}
function vibeCell(pts, seed) {
  return `<span class="v2rc-vibe ${pts > 0 ? "v2rc-vibe--pos" : "v2rc-vibe--bad"}">${vibeWord(pts, seed)}</span>`;
}

const TEAM_FLAGS = {
  // Europe
  "Albania": "al", "Andorra": "ad", "Armenia": "am",
  "Austria": "at", "Azerbaijan": "az", "Belarus": "by",
  "Belgium": "be", "Bosnia and Herzegovina": "ba", "Bosnia & Herzegovina": "ba", "Bulgaria": "bg",
  "Croatia": "hr", "Cyprus": "cy",
  "Czech Republic": "cz", "Czechia": "cz",
  "Denmark": "dk", "England": "gb-eng",
  "Estonia": "ee", "Faroe Islands": "fo",
  "Finland": "fi", "France": "fr",
  "Georgia": "ge", "Germany": "de",
  "Gibraltar": "gi", "Greece": "gr",
  "Hungary": "hu", "Iceland": "is",
  "Republic of Ireland": "ie", "Ireland": "ie",
  "Israel": "il", "Italy": "it",
  "Kosovo": "xk", "Latvia": "lv",
  "Liechtenstein": "li", "Lithuania": "lt",
  "Luxembourg": "lu", "Malta": "mt",
  "Moldova": "md", "Montenegro": "me",
  "Netherlands": "nl", "North Macedonia": "mk",
  "Northern Ireland": "gb-nir", "Norway": "no",
  "Poland": "pl", "Portugal": "pt",
  "Romania": "ro", "Russia": "ru",
  "San Marino": "sm", "Scotland": "gb-sct",
  "Serbia": "rs", "Slovakia": "sk",
  "Slovenia": "si", "Spain": "es",
  "Sweden": "se", "Switzerland": "ch",
  "Turkey": "tr", "Türkiye": "tr", "Turkiye": "tr", "Ukraine": "ua",
  "Wales": "gb-wls",
  // South America
  "Argentina": "ar", "Bolivia": "bo",
  "Brazil": "br", "Chile": "cl",
  "Colombia": "co", "Ecuador": "ec",
  "Paraguay": "py", "Peru": "pe",
  "Uruguay": "uy", "Venezuela": "ve",
  // North/Central America & Caribbean
  "Antigua and Barbuda": "ag", "Aruba": "aw",
  "Bahamas": "bs", "Barbados": "bb",
  "Belize": "bz", "Bermuda": "bm",
  "Canada": "ca", "Cayman Islands": "ky",
  "Costa Rica": "cr", "Cuba": "cu",
  "Curacao": "cw", "Curaçao": "cw",
  "Dominica": "dm", "Dominican Republic": "do",
  "El Salvador": "sv", "Grenada": "gd",
  "Guatemala": "gt", "Guyana": "gy",
  "Haiti": "ht", "Honduras": "hn",
  "Jamaica": "jm", "Mexico": "mx",
  "Montserrat": "ms", "Nicaragua": "ni",
  "Panama": "pa", "Puerto Rico": "pr",
  "Saint Kitts and Nevis": "kn", "Saint Lucia": "lc",
  "Saint Vincent and the Grenadines": "vc",
  "Sint Maarten": "sx", "Suriname": "sr",
  "Trinidad and Tobago": "tt",
  "USA": "us", "United States": "us",
  "US Virgin Islands": "vi",
  // Africa
  "Algeria": "dz", "Angola": "ao",
  "Benin": "bj", "Botswana": "bw",
  "Burkina Faso": "bf", "Burundi": "bi",
  "Cameroon": "cm", "Cape Verde": "cv", "Cape Verde Islands": "cv",
  "Central African Republic": "cf", "Chad": "td",
  "Comoros": "km", "Congo": "cg",
  "DR Congo": "cd", "Congo DR": "cd",
  "Djibouti": "dj", "Egypt": "eg",
  "Equatorial Guinea": "gq", "Eritrea": "er",
  "Eswatini": "sz", "Ethiopia": "et",
  "Gabon": "ga", "Gambia": "gm",
  "Ghana": "gh", "Guinea": "gn",
  "Guinea-Bissau": "gw",
  "Ivory Coast": "ci", "Cote d'Ivoire": "ci",
  "Kenya": "ke", "Lesotho": "ls",
  "Liberia": "lr", "Libya": "ly",
  "Madagascar": "mg", "Malawi": "mw",
  "Mali": "ml", "Mauritania": "mr",
  "Mauritius": "mu", "Morocco": "ma",
  "Mozambique": "mz", "Namibia": "na",
  "Niger": "ne", "Nigeria": "ng",
  "Rwanda": "rw", "Senegal": "sn",
  "Sierra Leone": "sl", "Somalia": "so",
  "South Africa": "za", "South Sudan": "ss",
  "Sudan": "sd", "Tanzania": "tz",
  "Togo": "tg", "Tunisia": "tn",
  "Uganda": "ug", "Zambia": "zm",
  "Zimbabwe": "zw",
  // Asia
  "Afghanistan": "af", "Australia": "au",
  "Bahrain": "bh", "Bangladesh": "bd",
  "Bhutan": "bt", "Cambodia": "kh",
  "China": "cn", "China PR": "cn",
  "Chinese Taipei": "tw", "Guam": "gu",
  "Hong Kong": "hk", "India": "in",
  "Indonesia": "id", "Iran": "ir", "Iraq": "iq",
  "Japan": "jp", "Jordan": "jo",
  "Kazakhstan": "kz", "Kuwait": "kw",
  "Kyrgyzstan": "kg", "Laos": "la",
  "Lebanon": "lb", "Malaysia": "my",
  "Maldives": "mv", "Mongolia": "mn",
  "Myanmar": "mm", "Nepal": "np",
  "North Korea": "kp", "DPR Korea": "kp",
  "Oman": "om", "Pakistan": "pk",
  "Palestine": "ps", "Philippines": "ph",
  "Qatar": "qa", "Saudi Arabia": "sa",
  "Singapore": "sg", "South Korea": "kr",
  "Korea Republic": "kr",
  "Sri Lanka": "lk", "Syria": "sy",
  "Tajikistan": "tj", "Thailand": "th",
  "Timor-Leste": "tl", "Turkmenistan": "tm",
  "United Arab Emirates": "ae", "UAE": "ae",
  "Uzbekistan": "uz", "Vietnam": "vn",
  "Yemen": "ye",
  // Oceania
  "American Samoa": "as", "Cook Islands": "ck",
  "Fiji": "fj", "New Caledonia": "nc",
  "New Zealand": "nz", "Papua New Guinea": "pg",
  "Samoa": "ws", "Solomon Islands": "sb",
  "Tahiti": "pf", "Tonga": "to",
  "Tuvalu": "tv", "Vanuatu": "vu",
};

export function withFlag(name) {
  const code = TEAM_FLAGS[name];
  const flag = code ? `<span class="fi fi-${code} team-flag"></span>` : "";
  return `${flag}<span class="team-name">${escapeHtml(name)}</span>`;
}

function showBetError(msg) {
  document.querySelector(".bet-error")?.remove();
  const el = document.createElement("div");
  el.className = "bet-error";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// getMatchPhase перенесён в points.js (чтобы порядок «Матчи сёдня» был покрыт
// node-тестом tests/test_today_matches.mjs). Здесь — импорт из points.js.

// OTS-47: матч уже отыгран по API (status ≥ 8), но плей-офф-исход ещё не определён
// (ничья, прошедший дальше неизвестен) — фаза «live», но это не игра, а ожидание.
function isAwaitingOutcome(match) {
  return Number(match.status) >= 8 && getMatchPhase(match) === "live";
}

function moscowLabel(dateTimeRaw) {
  try {
    const dt = new Date(dateTimeRaw);
    const date = dt.toLocaleDateString("ru-RU", {
      timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
    }); // "12.06"
    const time = dt.toLocaleTimeString("ru-RU", {
      timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hour12: false,
    }); // "21:00"
    return { date, time, full: `${date} · ${time}` };
  } catch {
    return { date: "", time: "", full: "" };
  }
}

export function renderMatches() {
  const container       = $("matches-list");
  const actualContainer = $("actual-matches-list");

  // Плашка «данные неполные», когда провайдер sstats лёг (фолбэк-кэш).
  const degradedBadge = $("matches-degraded-badge");
  if (degradedBadge) degradedBadge.classList.toggle("hidden", !matchesDegraded);

  let visibleMatches;
  if (isV2()) {
    // v2 «Матчи сёдня» (OTS-56, правка автора): СНАЧАЛА идущие матчи (live, со
    // ставками/карточкой как обычно — locked + бейдж ● LIVE), ЗАТЕМ предстоящие.
    // Завершённые — в «Результатах». Хвост будущего расписания — под кнопкой
    // «Показать все будущие матчи» ниже. Идущий матч теперь всегда виден сверху.
    visibleMatches = buildTodayMatches(activeMatches);
  } else {
    // v1: original behaviour — ended matches linger in the list ~26h
    const cutoff = Date.now() - 26 * 3600 * 1000;
    visibleMatches = activeMatches.filter((m) => {
      if (getMatchPhase(m) !== "ended") return true;
      try { return new Date(m.dateTimeRaw).getTime() >= cutoff; } catch { return true; }
    });
  }

  if (container) {
    container.innerHTML = "";
    if (!visibleMatches.length) {
      container.innerHTML = isV2()
        ? `<p class="muted">Сейчас нет открытых для ставок матчей. Завершённые ищи в «Результатах» ниже 👇</p>`
        : `<p class="muted">Матчи пока недоступны</p>`;
    } else {
      visibleMatches.forEach((m) => container.appendChild(
        isV2() ? createMatchRowV2(m) : createMatchRow(m, false)
      ));
    }
    // OTS-54: кнопка «Показать все будущие матчи» — раскрыть всё, что вне фильтра.
    if (isV2()) renderShowAllFuture(container, visibleMatches);
  }

  if (actualContainer) {
    actualContainer.innerHTML = "";
    visibleMatches.forEach((m) => actualContainer.appendChild(createMatchRow(m, true)));
  }
}

// OTS-54: «Показать все будущие матчи» — раскрыть все предстоящие матчи вне фильтра.
// Правка CEO: кнопка НЕ привязана к 1/16 — это просто «показать все будущие матчи».
// Рисуем ТОЛЬКО когда есть будущие матчи, которых нет в текущем фильтре. Тоггл:
// по умолчанию свёрнуто, раскрытие по желанию.
function renderShowAllFuture(container, visibleMatches) {
  container.querySelector(".round-extra-wrap")?.remove();
  if (!futureMatches.length) return;

  const visibleIds = new Set(visibleMatches.map((m) => String(m.id)));
  const extra = futureMatches
    .filter((m) => !visibleIds.has(String(m.id)))
    .sort((a, b) => String(a.dateTimeRaw).localeCompare(String(b.dateTimeRaw)));
  if (!extra.length) return;   // все будущие матчи уже в фильтре — кнопка не нужна

  const wrap = document.createElement("div");
  wrap.className = "round-extra-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "show-all-round-btn" + (showAllFuture ? " show-all-round-btn--on" : "");
  btn.setAttribute("aria-expanded", showAllFuture ? "true" : "false");
  btn.innerHTML = showAllFuture
    ? `Свернуть <span class="sarb-tag">будущие матчи</span>`
    : `Показать все будущие матчи <span class="sarb-tag">+${extra.length}</span>`;
  btn.addEventListener("click", () => {
    setShowAllFuture(!showAllFuture);
    renderShowAllFuture(container, visibleMatches);
  });
  wrap.appendChild(btn);

  if (showAllFuture) {
    const list = document.createElement("div");
    list.className = "round-extra-list";
    extra.forEach((m) => list.appendChild(createMatchRowV2(m)));
    wrap.appendChild(list);
  }

  container.appendChild(wrap);
}

export function createMatchRow(match, isActual) {
  const phase = getMatchPhase(match);
  const v2    = isV2();
  const row   = document.createElement("div");
  row.className = "match-row";

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "match-row-header";

  const odds = match.odds && typeof match.odds === "object" ? match.odds : {};
  const oddsHtml = `
    <div class="match-odds">
      <span>П1: ${odds.home ?? "-"}</span>
      <span>X: ${odds.draw ?? "-"}</span>
      <span>П2: ${odds.away ?? "-"}</span>
    </div>`;

  const moscow = moscowLabel(match.dateTimeRaw);
  let statusHtml;
  if (phase === "live") {
    statusHtml = isAwaitingOutcome(match)
      ? `<div class="match-time match-status--live">⏳ Ждём исход (доп. время / пенальти) · ${moscow.date}</div>`
      : `<div class="match-time match-status--live">● LIVE · ${moscow.date}</div>`;
  } else if (phase === "ended") {
    statusHtml = `<div class="match-time match-status--ended">Завершён ${match.homeScore ?? "?"}:${match.awayScore ?? "?"} · ${moscow.date}</div>`;
  } else {
    statusHtml = `<div class="match-time">${moscow.full || escapeHtml(match.time)}</div>`;
  }

  const leagueLine = [match.league, match.group].filter(Boolean).join(" · ");
  header.innerHTML = `
    <div class="match-teams">${withFlag(match.home)} — ${withFlag(match.away)}</div>
    ${statusHtml}
    ${leagueLine ? `<div class="match-group">${escapeHtml(leagueLine)}</div>` : ""}
    ${oddsHtml}`;

  // ── Inputs ───────────────────────────────────────────────────────────────────
  const inputs = document.createElement("div");
  inputs.className = isActual ? "match-actual" : "match-prediction";

  const scoreGroup = document.createElement("div");
  scoreGroup.className = "score-input-group";
  scoreGroup.innerHTML = `
    <input type="number" min="0" inputmode="numeric" placeholder="0" />
    <span>:</span>
    <input type="number" min="0" inputmode="numeric" placeholder="0" />`;

  const playerInput = document.createElement("input");
  playerInput.type = "text";
  playerInput.setAttribute("autocomplete", "off");
  playerInput.className = "match-player-input";
  playerInput.placeholder = isActual ? "Фактический лучший игрок" : "Лучший игрок матча";

  inputs.appendChild(scoreGroup);
  inputs.appendChild(playerInput);
  row.appendChild(header);
  row.appendChild(inputs);

  const [homeInput, awayInput] = scoreGroup.querySelectorAll("input");

  function readData() {
    return { home: homeInput.value.trim(), away: awayInput.value.trim(), bestPlayer: playerInput.value.trim() };
  }

  // ── Admin row ────────────────────────────────────────────────────────────────
  if (isActual) {
    const apiScoreAvailable = phase === "ended" && match.homeScore != null;
    const adminEntry = state.actualMatches?.[match.id];

    if (apiScoreAvailable) {
      homeInput.value  = String(match.homeScore);
      awayInput.value  = String(match.awayScore);
      homeInput.disabled = true;
      awayInput.disabled = true;
    } else {
      homeInput.value = adminEntry?.home ?? "";
      awayInput.value = adminEntry?.away ?? "";
    }
    const autoPlayer = Array.isArray(match.autoBestPlayer)
      ? match.autoBestPlayer.join(" / ")
      : (match.autoBestPlayer || "");
    const hasAdminOverride = Boolean(adminEntry?.bestPlayer);
    playerInput.value = adminEntry?.bestPlayer || autoPlayer;

    // Show a subtle badge when the value is auto-detected (not admin-overridden)
    if (autoPlayer && !hasAdminOverride) {
      const badge = document.createElement("span");
      badge.className = "auto-player-badge";
      badge.title = "Определено автоматически по рейтингу из API";
      badge.textContent = "авто";
      inputs.appendChild(badge);
    }

    const saveAdmin = async () => {
      const bestPlayer = playerInput.value.trim();
      try {
        await apiSaveActualMatch(match.id, { bestPlayer });
        if (!state.actualMatches[match.id]) state.actualMatches[match.id] = {};
        state.actualMatches[match.id].bestPlayer = bestPlayer;
        renderScoreboard();
      } catch (err) {
        console.error("Failed to save actual match:", err);
      }
    };

    playerInput.addEventListener("change", saveAdmin);
    attachDropdown(playerInput, match);

    // OTS-21 admin: в плей-офф админ фиксирует, КТО прошёл дальше (для ничьих по
    // пенальти счёт этого не показывает) + была ли серия пенальти.
    if (classifyKnockoutRound(match.group)) {
      const adminEntry2 = state.actualMatches?.[match.id];
      const po = document.createElement("div");
      po.className = "actual-playoff";

      const sel = document.createElement("select");
      sel.className = "actual-winner-select";
      [["", "Кто прошёл дальше…"], [match.home, match.home], [match.away, match.away]]
        .forEach(([val, label]) => {
          const opt = document.createElement("option");
          opt.value = val; opt.textContent = label;
          sel.appendChild(opt);
        });
      sel.value = adminEntry2?.winner || "";

      const penLabel = document.createElement("label");
      penLabel.className = "actual-pen-label";
      const penBox = document.createElement("input");
      penBox.type = "checkbox";
      penBox.checked = adminEntry2?.penalties === "yes";
      penLabel.append(penBox, document.createTextNode(" серия пенальти"));

      const savePlayoff = async () => {
        const payload = { winner: sel.value, penalties: penBox.checked ? "yes" : "no" };
        try {
          await apiSaveActualMatch(match.id, payload);
          if (!state.actualMatches[match.id]) state.actualMatches[match.id] = {};
          Object.assign(state.actualMatches[match.id], payload);
          renderScoreboard();
        } catch (err) {
          console.error("Failed to save playoff result:", err);
        }
      };
      sel.addEventListener("change", savePlayoff);
      penBox.addEventListener("change", savePlayoff);

      po.append(sel, penLabel);
      inputs.appendChild(po);
    }

  // ── User prediction row ───────────────────────────────────────────────────────
  } else {
    const prediction = currentUser.matches?.[match.id];
    homeInput.value  = prediction?.home ?? "";
    awayInput.value  = prediction?.away ?? "";
    playerInput.value = prediction?.bestPlayer ?? "";

    const editable = phase === "upcoming";
    homeInput.disabled  = !editable;
    awayInput.disabled  = !editable;
    playerInput.disabled = !editable;

    if (editable) {
      let getPlayers = () => null;

      // Real-time score limit: max 2 digits
      [homeInput, awayInput].forEach((inp) => {
        inp.addEventListener("input", () => {
          if (inp.value.length > 2) inp.value = inp.value.slice(0, 2);
        });
      });

      // Confirm button
      const hasPrediction = prediction?.home !== undefined && prediction?.home !== "";
      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "confirm-bet-btn";
      confirmBtn.textContent = hasPrediction ? "Изменить ставку" : "Подтвердить ставку";
      inputs.appendChild(confirmBtn);

      // v2: persistent saved indicator (doesn't vanish after 2s like the button flash)
      const savedNote = v2 ? document.createElement("div") : null;
      if (savedNote) {
        savedNote.className = "bet-saved-note" + (hasPrediction ? " bet-saved-note--on" : "");
        savedNote.textContent = hasPrediction ? "✓ ставка принята · можно менять" : "ставка ещё не сделана";
        inputs.appendChild(savedNote);
      }

      confirmBtn.addEventListener("click", async () => {
        const data = readData();

        // Validate score
        if (data.home === "" || data.away === "") {
          showBetError("Укажи счёт матча");
          return;
        }
        if (data.home.length > 2 || data.away.length > 2) {
          showBetError("Счёт: не больше 2 цифр");
          return;
        }

        // Validate player
        if (!data.bestPlayer) {
          showBetError("Укажи лучшего игрока матча");
          return;
        }

        // Validate player is from dropdown
        const players = getPlayers();
        if (players !== null && players.length > 0) {
          const valid = players.some(
            (p) => p.name.toLowerCase() === data.bestPlayer.toLowerCase()
          );
          if (!valid) {
            showBetError("Выбери лучшего игрока из выпадающего списка");
            playerInput.value = "";
            return;
          }
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = "Сохраняю…";
        currentUser.matches[match.id] = data;
        try {
          await apiSavePrediction(match.id, data);
          if (savedNote) {
            savedNote.className = "bet-saved-note bet-saved-note--on";
            savedNote.textContent = "✓ ставка принята · можно менять";
          }
          confirmBtn.className = "confirm-bet-btn confirm-bet-btn--saved";
          confirmBtn.textContent = "✓ Ставка принята";
          setTimeout(() => {
            confirmBtn.className = "confirm-bet-btn";
            confirmBtn.textContent = "Изменить ставку";
            confirmBtn.disabled = false;
          }, 2000);
        } catch (err) {
          console.error("Failed to save prediction:", err);
          const msg = err.message?.includes("начался") ? err.message : "Ошибка, попробуй ещё";
          confirmBtn.textContent = msg;
          confirmBtn.disabled = false;
        }
      });

      getPlayers = attachDropdown(playerInput, match);
    } else {
      const lockLabel = document.createElement("p");
      lockLabel.className = "match-locked-label";
      lockLabel.textContent = phase === "live" ? "Матч начался — ставки закрыты" : "Матч завершён — ставки закрыты";
      inputs.insertBefore(lockLabel, inputs.firstChild);
    }

    if (phase === "ended") {
      const pred   = currentUser.matches?.[match.id];
      const actual = resolveActualResult(match);
      const { total, outcomeCorrect, exactScore, bestPlayerCorrect } = matchPointsFor(pred, match);
      const isKo = Boolean(classifyKnockoutRound(match.group));
      const hints = [];
      if (exactScore)        hints.push("точный счёт");
      if (outcomeCorrect && (isKo || !exactScore)) hints.push(isKo ? "проход" : "исход");
      if (bestPlayerCorrect)  hints.push("игрок");

      const badge = document.createElement("div");
      badge.className = `match-points-badge ${total > 0 ? "match-points-badge--positive" : ""}`;
      badge.innerHTML = `<span class="match-points-value">+${total} pts</span>${hints.length ? `<span class="match-points-hints">${hints.join(" + ")}</span>` : ""}`;
      inputs.appendChild(badge);
    }
  }

  // Show all participants' bets once match has started
  if (phase !== "upcoming") {
    const allBets = createAllBetsSection(match, v2);
    if (allBets) row.appendChild(allBets);
  }

  return row;
}

// OTS-21: ввод плей-офф. «Кто пройдёт дальше» выбирается прямо в шапке — сами
// команды на уровне со счётом становятся кнопками (флаг + название), выбранная
// подсвечивается акцентом. Никаких отдельных блоков/подписей под счётом — не
// усложняем это место (прямой фидбэк Тимы). Тумблер пенальти убран: серия пенальти
// выводится из счёта (ничья в осн.+доп. → будет, иначе нет), penalties деривим при
// сохранении. Групповой этап → null.
function buildPlayoffControls(match, prediction, editable, teamEls) {
  if (!classifyKnockoutRound(match.group)) return null;

  let advance = prediction?.advance || "";
  let locked = false; // OTS-33: при решающем счёте проход залочен на победителя
  const teams = [match.home, match.away];
  const els = [teamEls.home, teamEls.away];

  const paint = () => {
    els.forEach((el, i) => {
      el.classList.toggle("v2mc-side-btn--on", advance === teams[i]);
      el.classList.toggle("v2mc-side-btn--locked", editable && locked);
      if (editable) el.title = locked
        ? "Проходит победитель по счёту"
        : "Выбрать, кто пройдёт по пенальти";
    });
  };

  // OTS-33 анти-чит: «кто пройдёт» обязан совпадать со счётом. Решающий счёт →
  // авто-выставляем победителя и лочим выбор (нельзя «счёт за A / проход за B»).
  // Ничья (осн.+доп.) → серия пенальти, выбор прохода свободный и обязательный.
  const decisiveWinner = (h, a) => {
    if (h === "" || a === "") return null;
    const nh = Number(h), na = Number(a);
    if (!Number.isFinite(nh) || !Number.isFinite(na) || nh === na) return null;
    return nh > na ? teams[0] : teams[1];
  };
  const syncWithScore = (h, a) => {
    const winner = decisiveWinner(h, a);
    locked = winner !== null;
    if (locked) advance = winner; // решающий счёт диктует прохождение
    paint();
  };

  els.forEach((el, i) => {
    if (editable) {
      el.classList.add("v2mc-side-btn");
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("title", "Выбрать, кто пройдёт по пенальти");
      const pick = () => { if (locked) return; advance = teams[i]; paint(); };
      el.addEventListener("click", pick);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });
    }
  });
  paint();

  return {
    el: null, // под счётом ничего не рисуем — выбор живёт в самих командах
    setAdvance: (team) => { advance = team; paint(); },
    getAdvance: () => advance,
    syncWithScore,
    pulse: () => {
      els.forEach((el) => {
        el.classList.remove("v2mc-side-btn--pulse");
        void el.offsetWidth; // reflow → перезапуск анимации
        el.classList.add("v2mc-side-btn--pulse");
        setTimeout(() => el.classList.remove("v2mc-side-btn--pulse"), 1400);
      });
    },
  };
}

// v2 "Матчи сёдня" card — mirrors the result hero: type·date line, flags + score
// boxes you fill, odds chips, then a player field + confirm button. Reuses the
// same save / dropdown / validation logic as the v1 row.
// OTS-43 — «Подсказка от Месси»: мерцающая AI-кнопка в углу карточки.
// Клик → нескучная загрузка → эпичный выезд короткой дерзкой подсказки.
const MESSI_LOADING = [
  "Лео достаёт инсайд…",
  "Лео смотрит запись…",
  "Лео звонит пацанам…",
  "Лео листает составы…",
  "ГОАТ на проводе…",
];

function mountMessiHint(row, match) {
  // Кнопка-аватар в углу карточки
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "v2mc-messi";
  btn.setAttribute("aria-label", "Подсказка от Месси");
  btn.title = "Подсказка от Месси";
  btn.innerHTML = `<img class="v2mc-messi-ava" src="/messi-ai.webp" alt="" width="42" height="42" draggable="false"><span class="v2mc-messi-ai">AI</span>`;
  row.appendChild(btn);

  // Панель с подсказкой (под шапкой карточки)
  const panel = document.createElement("div");
  panel.className = "v2mc-messi-panel";
  panel.hidden = true;
  row.querySelector(".v2rc-hero").insertAdjacentElement("afterend", panel);

  let cached = null;     // текст подсказки (клиентский кэш на повторный тык)
  let loading = false;
  let loopTimer = null;

  const stopLoop = () => { if (loopTimer) { clearInterval(loopTimer); loopTimer = null; } };

  const showLoading = () => {
    panel.className = "v2mc-messi-panel v2mc-messi-panel--loading";
    let i = 0;
    panel.innerHTML = `<img class="v2mc-messi-think" src="/messi-ai.webp" alt="" width="26" height="26" draggable="false"><span class="v2mc-messi-text"></span>`;
    const txt = panel.querySelector(".v2mc-messi-text");
    txt.textContent = MESSI_LOADING[0];
    loopTimer = setInterval(() => {
      i = (i + 1) % MESSI_LOADING.length;
      txt.textContent = MESSI_LOADING[i];
    }, 1800);
  };

  const showHint = (text) => {
    stopLoop();
    panel.className = "v2mc-messi-panel v2mc-messi-panel--done";
    panel.innerHTML = `<div class="v2mc-messi-quote"></div>`;
    panel.querySelector(".v2mc-messi-quote").textContent = text;  // textContent — без HTML-инъекций
  };

  const showError = (msg) => {
    stopLoop();
    panel.className = "v2mc-messi-panel v2mc-messi-panel--err";
    panel.innerHTML = `<div class="v2mc-messi-quote"></div>`;
    panel.querySelector(".v2mc-messi-quote").textContent =
      msg || "Лео отвлёкся на Кубок, попробуй ещё раз 🏆";
  };

  btn.addEventListener("click", async () => {
    // Повторный клик — просто сворачиваем/разворачиваем (бэк не дёргаем)
    if (!panel.hidden && !loading) { panel.hidden = true; btn.classList.remove("v2mc-messi--open"); return; }
    panel.hidden = false;
    btn.classList.add("v2mc-messi--open");
    if (cached) { showHint(cached); return; }
    if (loading) return;
    loading = true;
    btn.classList.add("v2mc-messi--busy");
    showLoading();
    try {
      const { hint } = await apiMatchHint(match.id);
      cached = hint;
      showHint(hint);
    } catch (err) {
      showError(err && err.message);
    } finally {
      loading = false;
      btn.classList.remove("v2mc-messi--busy");
    }
  });
}

function createMatchRowV2(match) {
  const phase      = getMatchPhase(match);   // 'upcoming' | 'live' (ended excluded from this list)
  const editable   = phase === "upcoming";
  const prediction = currentUser.matches?.[match.id];
  const moscow     = moscowLabel(match.dateTimeRaw);
  const typeBits   = [match.league, match.group, moscow.full].filter(Boolean).join(" · ");
  const odds       = match.odds && typeof match.odds === "object" ? match.odds : {};
  const oddsHtml   = (odds.home || odds.draw || odds.away) ? `
      <div class="v2mc-odds">
        <span>П1 ${escapeHtml(String(odds.home ?? "–"))}</span>
        <span>X ${escapeHtml(String(odds.draw ?? "–"))}</span>
        <span>П2 ${escapeHtml(String(odds.away ?? "–"))}</span>
      </div>` : "";
  const liveBadge  = isAwaitingOutcome(match)
    ? ` <span class="v2mc-live">⏳ ждём исход</span>`
    : (phase === "live" ? ` <span class="v2mc-live">● LIVE</span>` : "");

  const row = document.createElement("div");
  row.className = "match-row v2mc";
  row.id = "match-" + match.id;   // OTS-41: цель диплинка из бота (?match=<id>)

  const hero = document.createElement("div");
  hero.className = "v2rc-hero";
  hero.innerHTML = `
    <div class="v2rc-type">${escapeHtml(typeBits)}${liveBadge}</div>
    <div class="v2rc-scoreline">
      <span class="v2rc-t v2rc-t--r">${withFlag(match.home)}</span>
      <span class="v2mc-score"></span>
      <span class="v2rc-t">${withFlag(match.away)}</span>
    </div>
    ${oddsHtml}`;
  row.appendChild(hero);

  const slot = hero.querySelector(".v2mc-score");
  const homeInput = document.createElement("input");
  const awayInput = document.createElement("input");
  [homeInput, awayInput].forEach((inp) => {
    inp.type = "number"; inp.min = "0"; inp.inputMode = "numeric";
    inp.placeholder = "–"; inp.className = "v2mc-score-input";
  });
  const colon = document.createElement("span");
  colon.className = "v2mc-colon"; colon.textContent = ":";
  slot.append(homeInput, colon, awayInput);

  const controls = document.createElement("div");
  controls.className = "v2mc-controls";
  row.appendChild(controls);

  const playerInput = document.createElement("input");
  playerInput.type = "text";
  playerInput.setAttribute("autocomplete", "off");
  playerInput.className = "match-player-input v2mc-player";
  playerInput.placeholder = "Лучший игрок матча";
  controls.appendChild(playerInput);

  // OTS-21: в плей-офф сами команды в шапке = кнопки выбора проходящего; под
  // счётом ничего не добавляем.
  const teamSpans = hero.querySelectorAll(".v2rc-t");
  const playoff = buildPlayoffControls(match, prediction, editable, { home: teamSpans[0], away: teamSpans[1] });
  if (playoff?.el) hero.querySelector(".v2rc-scoreline").insertAdjacentElement("afterend", playoff.el);

  homeInput.value   = prediction?.home ?? "";
  awayInput.value   = prediction?.away ?? "";
  playerInput.value = prediction?.bestPlayer ?? "";
  homeInput.disabled = awayInput.disabled = playerInput.disabled = !editable;
  // OTS-33: согласуем «кто пройдёт» с уже сохранённым счётом (лочим при решающем).
  playoff?.syncWithScore(homeInput.value, awayInput.value);

  const readData = () => {
    const d = { home: homeInput.value.trim(), away: awayInput.value.trim(), bestPlayer: playerInput.value.trim() };
    if (playoff) {
      d.advance = playoff.getAdvance();
      // Пенальти деривим из счёта: ничья в осн.+доп. ⇒ серия пенальти.
      d.penalties = (d.home !== "" && d.away !== "" && Number(d.home) === Number(d.away)) ? "yes" : "no";
    }
    return d;
  };

  if (editable) {
    let getPlayers = () => null;
    [homeInput, awayInput].forEach((inp) => inp.addEventListener("input", () => {
      if (inp.value.length > 2) inp.value = inp.value.slice(0, 2);
      // OTS-33: счёт меняется → пересинхронизируем/лочим выбор прохода.
      playoff?.syncWithScore(homeInput.value, awayInput.value);
    }));

    const hasPrediction = prediction?.home !== undefined && prediction?.home !== "";
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "confirm-bet-btn";
    confirmBtn.textContent = hasPrediction ? "Изменить ставку" : "Подтвердить ставку";
    controls.appendChild(confirmBtn);

    const savedNote = document.createElement("div");
    savedNote.className = "bet-saved-note" + (hasPrediction ? " bet-saved-note--on" : "");
    savedNote.textContent = hasPrediction ? "✓ ставка принята · можно менять" : "ставка ещё не сделана";
    controls.appendChild(savedNote);

    // 🎰 Режим казика: огромная «НАУГАД БЛЯ» вместо «Изменить ставку».
    // Видна/скрыта чисто через CSS (body.casino-mode), так что переключение
    // режима не требует ре-рендера. Крутит только счёт, игрок — на участнике.
    const casinoBtn = document.createElement("button");
    casinoBtn.type = "button";
    casinoBtn.className = "casino-roll-btn";
    casinoBtn.textContent = "🎰 НАУГАД БЛЯ 🎰";
    controls.appendChild(casinoBtn);

    const saveBet = async () => {
      const data = readData();
      if (data.home === "" || data.away === "") { showBetError("Укажи счёт матча"); return; }
      if (data.home.length > 2 || data.away.length > 2) { showBetError("Счёт: не больше 2 цифр"); return; }
      if (playoff && !data.advance) { showBetError("Выбери, кто пройдёт дальше — тапни по команде"); playoff.pulse(); return; }
      if (!data.bestPlayer) { showBetError("Укажи лучшего игрока матча"); return; }
      const players = getPlayers();
      if (players !== null && players.length > 0) {
        const valid = players.some((p) => p.name.toLowerCase() === data.bestPlayer.toLowerCase());
        if (!valid) { showBetError("Выбери лучшего игрока из выпадающего списка"); playerInput.value = ""; return; }
      }
      confirmBtn.disabled = true; confirmBtn.textContent = "Сохраняю…";
      currentUser.matches[match.id] = data;
      try {
        await apiSavePrediction(match.id, data);
        savedNote.className = "bet-saved-note bet-saved-note--on";
        savedNote.textContent = "✓ ставка принята · можно менять";
        confirmBtn.className = "confirm-bet-btn confirm-bet-btn--saved";
        confirmBtn.textContent = "✓ Ставка принята";
        setTimeout(() => {
          confirmBtn.className = "confirm-bet-btn";
          confirmBtn.textContent = "Изменить ставку";
          confirmBtn.disabled = false;
        }, 1500);
      } catch (err) {
        console.error("Failed to save prediction:", err);
        confirmBtn.textContent = err.message?.includes("начался") ? err.message : "Ошибка, попробуй ещё";
        confirmBtn.disabled = false;
      }
    };

    confirmBtn.addEventListener("click", saveBet);

    casinoBtn.addEventListener("click", async () => {
      if (casinoBtn.disabled) return;
      casinoBtn.disabled = true;
      try {
        let pool = getPlayers();                        // список игроков обоих составов
        if (!pool || !pool.length) pool = await fetchMatchPlayers(match);
        const res = await runScoreSlot(pool || []);     // крутим: счёт + случайный игрок
        if (!res) return;                               // «не ставить» — выходим без сохранения
        homeInput.value = res.home;
        awayInput.value = res.away;
        if (res.player) playerInput.value = res.player; // игрок тоже выпал на слоте
        if (playoff) {
          // наугад: решающий счёт сам залочит победителя; на ничьей — монетка
          playoff.syncWithScore(res.home, res.away);
          if (Number(res.home) === Number(res.away)) {
            playoff.setAdvance(Math.random() < 0.5 ? match.home : match.away);
          }
        }
        await saveBet();
      } finally {
        casinoBtn.disabled = false;
      }
    });

    getPlayers = attachDropdown(playerInput, match);
  } else {
    const lock = document.createElement("p");
    lock.className = "match-locked-label";
    lock.textContent = "Матч начался — ставки закрыты";
    controls.insertBefore(lock, controls.firstChild);
  }

  if (phase !== "upcoming") {
    const allBets = createAllBetsSection(match, true);
    if (allBets) row.appendChild(allBets);
  }

  // OTS-43 — кнопка «Подсказка от Месси» в углу карточки
  mountMessiHint(row, match);

  return row;
}

function createAllBetsSection(match, collapsible = false) {
  if (!state.users?.length) return null;

  const entries = state.users
    .filter((u) => {
      const p = u.matches?.[match.id];
      return p && (p.home !== "" || p.away !== "");
    })
    .map((u) => ({ nickname: u.nickname, ...u.matches[match.id] }));

  if (!entries.length) return null;

  // OTS-39: в плей-офф во время матча показываем флаг команды, на проход которой
  // ставил участник (пик advance или вывод из счёта). Для группового этапа прохода
  // нет — флаг не выводим.
  const isPlayoff = Boolean(classifyKnockoutRound(match.group));
  const advanceFlag = (e) => {
    if (!isPlayoff) return "";
    const team = predictedAdvance(e, match);
    if (!team) return `<span class="all-bets-flag all-bets-flag--empty" title="проход не выбран">—</span>`;
    const code = TEAM_FLAGS[team];
    const inner = code
      ? `<span class="fi fi-${code} team-flag"></span>`
      : escapeHtml(team);
    return `<span class="all-bets-flag" title="пройдёт дальше: ${escapeHtml(team)}">${inner}</span>`;
  };

  const rowsHtml = entries.map((e) => `
      <div class="all-bets-row">
        <span class="all-bets-nick">${escapeHtml(e.nickname)}</span>
        ${advanceFlag(e)}
        <span class="all-bets-score">${e.home ?? "—"}:${e.away ?? "—"}</span>
        <span class="all-bets-player">${e.bestPlayer ? escapeHtml(e.bestPlayer) : "—"}</span>
      </div>`).join("");

  if (collapsible) {
    const details = document.createElement("details");
    details.className = "match-all-bets match-all-bets--collapsible";
    details.innerHTML =
      `<summary class="all-bets-summary">Ставки участников (${entries.length})</summary>` +
      `<div class="all-bets-body">${rowsHtml}</div>`;
    return details;
  }

  const section = document.createElement("div");
  section.className = "match-all-bets";
  section.innerHTML = `<div class="all-bets-title">Ставки участников</div>${rowsHtml}`;
  return section;
}

// Players for both squads (used by the casino slot to roll a random best player).
async function fetchMatchPlayers(match) {
  const { homeTeamId, awayTeamId } = match;
  if (!homeTeamId || !awayTeamId) return [];
  try {
    const [hp, ap] = await Promise.all([getTeamPlayers(homeTeamId), getTeamPlayers(awayTeamId)]);
    return [...hp, ...ap];
  } catch { return []; }
}

function attachDropdown(playerInput, match) {
  let allPlayers = null;

  async function loadPlayers() {
    if (allPlayers !== null) return;
    const { homeTeamId, awayTeamId } = match;
    if (!homeTeamId || !awayTeamId) { allPlayers = []; return; }
    const [hp, ap] = await Promise.all([getTeamPlayers(homeTeamId), getTeamPlayers(awayTeamId)]);
    allPlayers = [...hp, ...ap];
  }

  function showFiltered() {
    if (!allPlayers?.length) return;
    const query = playerInput.value.trim().toLowerCase();
    const filtered = query
      ? allPlayers.filter((p) =>
          p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(query))
        )
      : allPlayers;
    createPlayerDropdown(filtered, playerInput);
  }

  playerInput.addEventListener("focus", async () => {
    try { await loadPlayers(); showFiltered(); } catch { /* not critical */ }
  });

  playerInput.addEventListener("input", async () => {
    try { await loadPlayers(); showFiltered(); } catch { /* not critical */ }
  });

  return () => allPlayers;
}

export function createPlayerDropdown(players, inputEl) {
  document.querySelector(".player-dropdown")?.remove();
  if (!players.length) return;

  const dropdown = document.createElement("div");
  dropdown.className = "player-dropdown";

  players.forEach((p) => {
    const item = document.createElement("div");
    item.className = "player-dropdown-item";
    item.textContent = p.name;
    item.addEventListener("click", () => {
      inputEl.value = p.name;
      dropdown.remove();
      inputEl.dispatchEvent(new Event("change"));
    });
    dropdown.appendChild(item);
  });

  document.body.appendChild(dropdown);
  const rect = inputEl.getBoundingClientRect();
  dropdown.style.position = "absolute";
  dropdown.style.left  = rect.left  + window.scrollX + "px";
  dropdown.style.top   = rect.bottom + window.scrollY + "px";
  dropdown.style.width = rect.width + "px";
}

document.addEventListener("click", (e) => {
  const dd = document.querySelector(".player-dropdown");
  if (!dd) return;
  if (!dd.contains(e.target) && !e.target.classList.contains("match-player-input")) dd.remove();
});

// ── Match results (completed matches with scores + points) ────────────────────

export async function renderMatchResults() {
  const container = $("match-results-list");
  if (!container) return;

  const ended = activeMatches.filter(isMatchResultFinal);

  if (!ended.length) {
    container.innerHTML = `<p class="muted small">Завершённых матчей пока нет.</p>`;
    return;
  }

  // Fetch player ratings for all ended matches in parallel
  const ratingsArr = await Promise.all(
    ended.map((m) => apiGetMatchRatings(m.id).catch(() => ({})))
  );
  const ratingsMap = Object.fromEntries(ended.map((m, i) => [m.id, ratingsArr[i]]));

  container.innerHTML = "";
  const v2 = isV2();
  const list = v2
    ? [...ended].sort((a, b) => String(b.dateTimeRaw).localeCompare(String(a.dateTimeRaw)))
    : ended;
  list.forEach((m) => container.appendChild(
    v2 ? createResultCardV2(m, ratingsMap[m.id] || {}, currentUser, state.users)
       : createResultCard(m, ratingsMap[m.id] || {})
  ));
}

function ratingTag(ratings, name) {
  if (!name || !ratings) return "";
  // 1. Exact
  let r = ratings[name];
  if (r == null) {
    // 2. Case-insensitive
    const low = name.toLowerCase();
    const key = Object.keys(ratings).find((k) => k.toLowerCase() === low);
    if (key) r = ratings[key];
  }
  if (r == null) {
    // 3. Last-name match (handles "Messi" ↔ "Lionel Messi")
    const lastName = name.trim().split(/\s+/).pop().toLowerCase();
    const key = Object.keys(ratings).find(
      (k) => k.trim().split(/\s+/).pop().toLowerCase() === lastName
    );
    if (key) r = ratings[key];
  }
  return r != null ? ` <span class="player-rating">[${r.toFixed(1)}]</span>` : "";
}

export async function renderPlayerProfile(nickname, containerEl) {
  const user = state.users.find((u) => u.nickname === nickname);
  if (!user) { containerEl.innerHTML = `<p class="muted">Пользователь не найден.</p>`; return; }

  const ended = activeMatches.filter(isMatchResultFinal);
  if (!ended.length) { containerEl.innerHTML = `<p class="muted small">Завершённых матчей пока нет.</p>`; return; }

  const ratingsArr = await Promise.all(ended.map((m) => apiGetMatchRatings(m.id).catch(() => ({}))));
  const ratingsMap = Object.fromEntries(ended.map((m, i) => [m.id, ratingsArr[i]]));

  containerEl.innerHTML = "";
  const v2 = isV2();
  ended.forEach((m) => containerEl.appendChild(
    v2 ? createResultCardV2(m, ratingsMap[m.id] || {}, user, state.users)
       : createResultCard(m, ratingsMap[m.id] || {}, user)
  ));
}

function createResultCard(match, ratings = {}, viewUser = null) {
  const pred   = (viewUser ?? currentUser)?.matches?.[match.id];
  const actual = resolveActualResult(match);
  const { total, outcomeCorrect, exactScore, bestPlayerCorrect } =
    matchPointsFor(pred, match);
  const isKo = Boolean(classifyKnockoutRound(match.group));

  const leagueLine = [match.league, match.group].filter(Boolean).join(" · ");

  const predScore =
    pred?.home !== "" && pred?.away !== "" && pred?.home != null
      ? `${pred.home}:${pred.away}`
      : "—";

  const hints = [];
  if (exactScore)          hints.push("точный счёт");
  if (outcomeCorrect && (isKo || !exactScore)) hints.push(isKo ? "проход" : "исход");
  if (bestPlayerCorrect)   hints.push("игрок");

  const actualBestRaw = actual?.bestPlayer || match.autoBestPlayer || "";
  const actualBestList = Array.isArray(actualBestRaw) ? actualBestRaw : (actualBestRaw ? [actualBestRaw] : []);
  const actualBestHtml = actualBestList.map(p => `${escapeHtml(p)}${ratingTag(ratings, p)}`).join(" / ");
  const userPlayer = pred?.bestPlayer || "";

  const card = document.createElement("div");
  card.className = "result-card";
  card.innerHTML = `
    <div class="result-card__header">
      <div>
        <div class="result-card__teams">${withFlag(match.home)} — ${withFlag(match.away)}</div>
        ${leagueLine ? `<div class="result-card__league muted small">${escapeHtml(leagueLine)}</div>` : ""}
      </div>
      <div class="result-card__actual-score">${match.homeScore ?? "?"}:${match.awayScore ?? "?"}</div>
    </div>
    <div class="result-card__body">
      <div class="result-card__prediction">
        <span class="muted small">Ваша ставка</span>
        <span class="result-card__pred-score">${escapeHtml(predScore)}</span>
        ${userPlayer ? `<span class="muted small">Игрок: ${escapeHtml(userPlayer)}${ratingTag(ratings, userPlayer)}</span>` : ""}
        ${actualBestHtml ? `<span class="muted small result-card__actual-player">Факт. игрок: ${actualBestHtml}</span>` : ""}
      </div>
      <div class="result-card__points ${total > 0 ? "result-card__points--positive" : ""}">
        <span class="result-card__pts">+${total} pts</span>
        ${hints.length ? `<span class="result-card__hints muted small">${hints.join(" + ")}</span>` : ""}
      </div>
    </div>
  `;
  return card;
}

// ── v2 result card: one aligned table. "ИТОГ" (real result), "ТЫ" (your bet),
//    then participants — all share the same score / player / points columns so
//    the eye reads straight down instead of darting around. ───────────────────
function createResultCardV2(match, ratings = {}, viewUser = null, allUsers = []) {
  const me     = viewUser ?? currentUser;
  const actual = resolveActualResult(match);
  const moscow = moscowLabel(match.dateTimeRaw);
  const typeLine = [match.league, match.group, moscow.full].filter(Boolean).join(" · ");
  const actualScore = `${match.homeScore ?? "?"}:${match.awayScore ?? "?"}`;
  const fmtPts = (t) => (t > 0 ? `+${t}` : "0");

  const actualBestRaw  = actual?.bestPlayer || match.autoBestPlayer || "";
  const actualBestList = Array.isArray(actualBestRaw) ? actualBestRaw : (actualBestRaw ? [actualBestRaw] : []);
  const actualBestHtml = actualBestList.map((p) => `${escapeHtml(p)}${ratingTag(ratings, p)}`).join(" / ") || "—";

  // OTS-36: в плей-офф перед счётом — колонка «исход»: флаг команды, на проход
  // которой ставил игрок (для ТЫ и для всех участников). Заменяет прежнюю
  // отдельную строку-разбивку «Проход ✓ … Счёт ✗ … Игрок».
  const isPlayoff = Boolean(classifyKnockoutRound(match.group));
  const flagOnly = (name) => {
    if (!name) return '<span class="v2rc-muted">—</span>';
    const code = TEAM_FLAGS[name];
    return code
      ? `<span class="fi fi-${code} team-flag" title="${escapeHtml(name)}"></span>`
      : escapeHtml(name);
  };
  const outcomeCell = (advance) =>
    isPlayoff ? `<span class="v2rc-outcome">${flagOnly(advance)}</span>` : "";

  // One aligned row: who | [исход] | score | player | vibe | pts
  const row = (cls, who, outcomeHtml, score, playerHtml, vibeHtml, ptsHtml) => `
    <div class="v2rc-row ${cls}">
      <span class="v2rc-who">${who}</span>
      ${outcomeHtml}
      <span class="v2rc-score">${escapeHtml(score)}</span>
      <span class="v2rc-player">${playerHtml}</span>
      ${vibeHtml}
      <span class="v2rc-pts">${ptsHtml}</span>
    </div>`;

  const labelRow = row("v2rc-row--label",
    "", isPlayoff ? `<span class="v2rc-outcome"></span>` : "",
    "счёт", "<span>лучший игрок</span>", `<span class="v2rc-vibe"></span>`, "<span>очки</span>");

  // My bet
  const pred = me?.matches?.[match.id];
  const predHas = pred?.home !== "" && pred?.away !== "" && pred?.home != null;
  const myScore = predHas ? `${pred.home}:${pred.away}` : "—";
  const myPlayer = pred?.bestPlayer ? escapeHtml(pred.bestPlayer) + ratingTag(ratings, pred.bestPlayer) : "—";
  const myInfo = matchPointsFor(pred, match);
  const myPts = myInfo.total;
  const myRow = row("v2rc-row--mine", "ТЫ", outcomeCell(predictedAdvance(pred, match)), myScore, myPlayer,
    vibeCell(myPts, match.id + (me?.nickname || "")),
    `<span class="${myPts > 0 ? "v2rc-pos" : ""}">${fmtPts(myPts)}</span>`);

  // Everyone else who bet — same columns, sorted by points
  const others = (allUsers || [])
    .filter((u) => u.nickname !== me?.nickname)
    .map((u) => ({ u, p: u.matches?.[match.id] }))
    .filter((x) => x.p && (x.p.home !== "" || x.p.away !== ""))
    .map((x) => ({
      nick: x.u.nickname,
      advance: predictedAdvance(x.p, match),
      score: `${x.p.home ?? "—"}:${x.p.away ?? "—"}`,
      player: x.p.bestPlayer ? escapeHtml(x.p.bestPlayer) + ratingTag(ratings, x.p.bestPlayer) : "—",
      pts: matchPointsFor(x.p, match).total,
    }))
    .sort((a, b) => b.pts - a.pts);

  const othersHtml = others.length ? `
    <details class="v2rc-others">
      <summary class="v2rc-others-sum">Ставки участников (${others.length})</summary>
      <div class="v2rc-grid${isPlayoff ? " v2rc-grid--ko" : ""}">
        ${others.map((o) => row("v2rc-row--other", escapeHtml(o.nick), outcomeCell(o.advance), o.score, o.player,
            vibeCell(o.pts, match.id + o.nick),
            `<span class="${o.pts > 0 ? "v2rc-pos" : "v2rc-muted"}">${fmtPts(o.pts)}</span>`)).join("")}
      </div>
    </details>` : "";

  // Кнопку шеринга показываем только для своей карточки и только если ты реально
  // ставил на этот матч (иначе хвастаться нечем).
  const ownCard = !viewUser || me === currentUser;
  const canShare = ownCard && predHas;
  const shareRow = canShare
    ? `<button type="button" class="share-btn" title="Поделиться картинкой" aria-label="Поделиться картинкой">📲</button>`
    : "";

  // OTS-21/47: в плей-офф показываем, кто реально прошёл (в шапке карточки). Для
  // серии пенальти — с авто-подтянутым из API счётом серии («по пенальти 3:4»).
  const hasPenScore = actual?.penalties === "yes" && actual?.penHome != null && actual.penHome !== "";
  // Явная строка серии под основным счётом — самое заметное место («1:1» → «по пен. 3:4»).
  const penLineHtml = hasPenScore
    ? `<div class="v2rc-penline">по пенальти ${escapeHtml(String(actual.penHome))}:${escapeHtml(String(actual.penAway))}</div>`
    : (actual?.penalties === "yes" ? `<div class="v2rc-penline">по пенальти</div>` : "");
  const advancedHtml = (isPlayoff && actual?.winner)
    ? `<div class="v2rc-advanced">прошёл дальше: ${withFlag(actual.winner)}</div>`
    : "";

  const card = document.createElement("div");
  card.className = "result-card v2rc";
  card.innerHTML = `
    ${shareRow}
    <div class="v2rc-hero">
      ${typeLine ? `<div class="v2rc-type">${escapeHtml(typeLine)}</div>` : ""}
      <div class="v2rc-scoreline">
        <span class="v2rc-t v2rc-t--r">${withFlag(match.home)}</span>
        <span class="v2rc-nums">${match.homeScore ?? "?"} : ${match.awayScore ?? "?"}</span>
        <span class="v2rc-t">${withFlag(match.away)}</span>
      </div>
      ${penLineHtml}
      <div class="v2rc-best">⭐ ${actualBestHtml}</div>
      ${advancedHtml}
    </div>
    <div class="v2rc-grid${isPlayoff ? " v2rc-grid--ko" : ""}">
      ${labelRow}
      ${myRow}
    </div>
    ${othersHtml}
  `;

  if (canShare) {
    const verdict = myInfo.exactScore
      ? { label: "🎯 В ТОЧКУ", tone: "exact" }
      : myInfo.outcomeCorrect
        ? { label: "✅ ЗАШЛО", tone: "win" }
        : { label: "❌ СЛИЛ", tone: "lose" };
    const btn = card.querySelector(".share-btn");
    btn?.addEventListener("click", () =>
      openShareCard(
        {
          home: match.home,
          away: match.away,
          homeCode: TEAM_FLAGS[match.home] || "",
          awayCode: TEAM_FLAGS[match.away] || "",
          homeScore: match.homeScore ?? "?",
          awayScore: match.awayScore ?? "?",
          predScore: `${pred.home}:${pred.away}`,
          pts: myPts,
          verdict,
          vibe: vibeWord(myPts, match.id + (me?.nickname || "")),
          nick: me?.nickname || "Аноним с Otsos",
          typeLine,
        },
        btn
      )
    );
  }

  return card;
}
