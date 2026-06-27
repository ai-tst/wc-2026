import { state, currentUser, activeMatches } from "./store.js";
import { $, escapeHtml } from "./utils.js";
import { getTeamPlayers } from "./api.js";
import { renderScoreboard } from "./scoreboard.js";
import { calculatePointsForMatch, resolveActualResult } from "./points.js";
import { apiSavePrediction, apiSaveActualMatch, apiGetMatchRatings } from "./api-client.js";

const ERROR_MSG = "Да отсоси ты хуй бля";

function isV2() {
  return currentUser?.designVersion === "v2";
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
  "Belgium": "be", "Bosnia and Herzegovina": "ba", "Bulgaria": "bg",
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
  "Turkey": "tr", "Ukraine": "ua",
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
  "Cameroon": "cm", "Cape Verde": "cv",
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

function getMatchPhase(match) {
  const s = Number(match.status);
  if (!s || s <= 2) return "upcoming";
  if (s <= 7) return "live";
  return "ended";
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

  let visibleMatches;
  if (isV2()) {
    // v2: "Матчи сёдня" = live (top) + still-bettable upcoming only.
    // Finished matches live exclusively in "Результаты" → no more duplication.
    const order = { live: 0, upcoming: 1, ended: 2 };
    visibleMatches = activeMatches
      .filter((m) => getMatchPhase(m) !== "ended")
      .sort((a, b) => {
        const pa = order[getMatchPhase(a)], pb = order[getMatchPhase(b)];
        if (pa !== pb) return pa - pb;
        return String(a.dateTimeRaw).localeCompare(String(b.dateTimeRaw));
      });
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
        ? `<p class="muted">Сейчас нет live и открытых для ставок матчей. Завершённые ищи в «Результатах» ниже 👇</p>`
        : `<p class="muted">Матчи пока недоступны</p>`;
    } else {
      visibleMatches.forEach((m) => container.appendChild(
        isV2() ? createMatchRowV2(m) : createMatchRow(m, false)
      ));
    }
  }

  if (actualContainer) {
    actualContainer.innerHTML = "";
    visibleMatches.forEach((m) => actualContainer.appendChild(createMatchRow(m, true)));
  }
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
    statusHtml = `<div class="match-time match-status--live">● LIVE · ${moscow.date}</div>`;
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
      const { total, outcomeCorrect, exactScore, bestPlayerCorrect } = calculatePointsForMatch(pred, actual);
      const hints = [];
      if (exactScore)        hints.push("точный счёт");
      else if (outcomeCorrect) hints.push("исход");
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

// v2 "Матчи сёдня" card — mirrors the result hero: type·date line, flags + score
// boxes you fill, odds chips, then a player field + confirm button. Reuses the
// same save / dropdown / validation logic as the v1 row.
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
  const liveBadge  = phase === "live" ? ` <span class="v2mc-live">● LIVE</span>` : "";

  const row = document.createElement("div");
  row.className = "match-row v2mc";

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

  homeInput.value   = prediction?.home ?? "";
  awayInput.value   = prediction?.away ?? "";
  playerInput.value = prediction?.bestPlayer ?? "";
  homeInput.disabled = awayInput.disabled = playerInput.disabled = !editable;

  const readData = () => ({ home: homeInput.value.trim(), away: awayInput.value.trim(), bestPlayer: playerInput.value.trim() });

  if (editable) {
    let getPlayers = () => null;
    [homeInput, awayInput].forEach((inp) => inp.addEventListener("input", () => {
      if (inp.value.length > 2) inp.value = inp.value.slice(0, 2);
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

    confirmBtn.addEventListener("click", async () => {
      const data = readData();
      if (data.home === "" || data.away === "") { showBetError("Укажи счёт матча"); return; }
      if (data.home.length > 2 || data.away.length > 2) { showBetError("Счёт: не больше 2 цифр"); return; }
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

  const rowsHtml = entries.map((e) => `
      <div class="all-bets-row">
        <span class="all-bets-nick">${escapeHtml(e.nickname)}</span>
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

  const ended = activeMatches.filter((m) => Number(m.status) >= 8);

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

  const ended = activeMatches.filter((m) => Number(m.status) >= 8);
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
    calculatePointsForMatch(pred, actual);

  const leagueLine = [match.league, match.group].filter(Boolean).join(" · ");

  const predScore =
    pred?.home !== "" && pred?.away !== "" && pred?.home != null
      ? `${pred.home}:${pred.away}`
      : "—";

  const hints = [];
  if (exactScore)          hints.push("точный счёт");
  else if (outcomeCorrect) hints.push("исход");
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

  // One aligned row: who | score | player | pts
  const row = (cls, who, score, playerHtml, vibeHtml, ptsHtml) => `
    <div class="v2rc-row ${cls}">
      <span class="v2rc-who">${who}</span>
      <span class="v2rc-score">${escapeHtml(score)}</span>
      <span class="v2rc-player">${playerHtml}</span>
      ${vibeHtml}
      <span class="v2rc-pts">${ptsHtml}</span>
    </div>`;

  const labelRow = row("v2rc-row--label",
    "", "счёт", "<span>лучший игрок</span>", `<span class="v2rc-vibe"></span>`, "<span>очки</span>");

  // My bet
  const pred = me?.matches?.[match.id];
  const predHas = pred?.home !== "" && pred?.away !== "" && pred?.home != null;
  const myScore = predHas ? `${pred.home}:${pred.away}` : "—";
  const myPlayer = pred?.bestPlayer ? escapeHtml(pred.bestPlayer) + ratingTag(ratings, pred.bestPlayer) : "—";
  const myPts = calculatePointsForMatch(pred, actual).total;
  const myRow = row("v2rc-row--mine", "ТЫ", myScore, myPlayer,
    vibeCell(myPts, match.id + (me?.nickname || "")),
    `<span class="${myPts > 0 ? "v2rc-pos" : ""}">${fmtPts(myPts)}</span>`);

  // Everyone else who bet — same columns, sorted by points
  const others = (allUsers || [])
    .filter((u) => u.nickname !== me?.nickname)
    .map((u) => ({ u, p: u.matches?.[match.id] }))
    .filter((x) => x.p && (x.p.home !== "" || x.p.away !== ""))
    .map((x) => ({
      nick: x.u.nickname,
      score: `${x.p.home ?? "—"}:${x.p.away ?? "—"}`,
      player: x.p.bestPlayer ? escapeHtml(x.p.bestPlayer) + ratingTag(ratings, x.p.bestPlayer) : "—",
      pts: calculatePointsForMatch(x.p, actual).total,
    }))
    .sort((a, b) => b.pts - a.pts);

  const othersHtml = others.length ? `
    <details class="v2rc-others">
      <summary class="v2rc-others-sum">Ставки участников (${others.length})</summary>
      <div class="v2rc-grid">
        ${others.map((o) => row("v2rc-row--other", escapeHtml(o.nick), o.score, o.player,
            vibeCell(o.pts, match.id + o.nick),
            `<span class="${o.pts > 0 ? "v2rc-pos" : "v2rc-muted"}">${fmtPts(o.pts)}</span>`)).join("")}
      </div>
    </details>` : "";

  const card = document.createElement("div");
  card.className = "result-card v2rc";
  card.innerHTML = `
    <div class="v2rc-hero">
      ${typeLine ? `<div class="v2rc-type">${escapeHtml(typeLine)}</div>` : ""}
      <div class="v2rc-scoreline">
        <span class="v2rc-t v2rc-t--r">${withFlag(match.home)}</span>
        <span class="v2rc-nums">${match.homeScore ?? "?"} : ${match.awayScore ?? "?"}</span>
        <span class="v2rc-t">${withFlag(match.away)}</span>
      </div>
      <div class="v2rc-best">⭐ ${actualBestHtml}</div>
    </div>
    <div class="v2rc-grid">
      ${labelRow}
      ${myRow}
    </div>
    ${othersHtml}
  `;
  return card;
}
