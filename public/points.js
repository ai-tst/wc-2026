import { state, activeMatches } from "./store.js";
import { parseDarkHorse } from "./utils.js";

// OTS-73: человеческий матчинг имени игрока. Зеркало _players_match в server.py
// (golden-тесты сверяют поведение). Засчитываем, если введённое имя однозначно
// указывает на официального лучшего игрока: полное имя, имя+фамилия, только
// фамилия (в т.ч. когда официальное имя — испанское с двумя фамилиями, как
// «Lamine Yamal Nasraoui Ebana» ⟵ «Yamal»), кириллический транслит (Ямал/Ямаль),
// иной регистр/пробелы/пунктуация, мелкие опечатки. Не засчитываем при
// неоднозначности внутри состава матча (две одинаковые фамилии → по фамилии нет).

// Кириллица → латиница (частый футбольный транслит). Делаем ДО снятия диакритики.
const _CYR_MAP = {
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",
  л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",
  ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
};

// Частицы/суффиксы — не «сильные» токены (сами по себе не решают совпадение).
const _PARTICLES = new Set([
  "de","del","da","di","do","dos","das","della","la","le","van","von","der",
  "den","al","el","bin","ibn","san","st","saint","junior","jnr","jr","the","of",
]);

function normalizePlayerStr(name) {
  let s = (name || "").toLowerCase();
  s = s.replace(/[а-яё]/g, (c) => (c in _CYR_MAP ? _CYR_MAP[c] : c));
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); // снять латинскую диакритику
  s = s.replace(/['’`]/g, "");                             // O'Neil→oneil, N'Golo→ngolo
  return s.trim();
}

function playerTokens(name) {
  return normalizePlayerStr(name).split(/[^a-z0-9.]+/).filter(Boolean);
}

function _levenshtein1(a, b) {
  // true, если правок ≤ 1 (достаточно для «мелких опечаток»)
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++;            // удаление из a
    else if (lb > la) j++;       // вставка
    else { i++; j++; }           // замена
  }
  if (i < la || j < lb) edits++; // хвостовой лишний символ
  return edits <= 1;
}

function _stripInitial(t) { return t.replace(/\.+$/, ""); }
function _isStrongTok(t) { const s = _stripInitial(t); return s.length >= 3 && !_PARTICLES.has(s); }

function _tokMatch(x, y) {
  const xs = _stripInitial(x), ys = _stripInitial(y);
  if (!xs || !ys) return false;
  if (xs === ys) return true;
  // инициал: «J.» ~ «Julian»
  if (xs.length === 1 && ys.startsWith(xs)) return true;
  if (ys.length === 1 && xs.startsWith(ys)) return true;
  // мелкая опечатка (только для достаточно длинных токенов)
  if (xs.length >= 5 && ys.length >= 5 && _levenshtein1(xs, ys)) return true;
  return false;
}

function _subsetTokens(A, B) {
  // каждый токен A находит свою (непереиспользованную) пару в B
  const used = new Array(B.length).fill(false);
  for (const a of A) {
    let hit = -1;
    for (let j = 0; j < B.length; j++) { if (!used[j] && _tokMatch(a, B[j])) { hit = j; break; } }
    if (hit < 0) return false;
    used[hit] = true;
  }
  return true;
}

function _tokensMatch(A, B) {
  if (!A.length || !B.length) return false;
  if (A.length === B.length && A.every((t, i) => t === B[i])) return true; // точное равенство
  if (!(_subsetTokens(A, B) || _subsetTokens(B, A))) return false;
  // нужен хотя бы один «сильный» общий токен (не инициал, не частица)
  for (const a of A) for (const b of B) {
    if (_isStrongTok(a) && _isStrongTok(b) && _tokMatch(a, b)) return true;
  }
  return false;
}

// squad (опционально) — имена игроков матча; если введённое имя подходит к 2+
// разным игрокам состава, оно неоднозначно и НЕ засчитывается (две одинаковые
// фамилии в матче → по фамилии не матчим).
function playerNamesMatch(input, target, squad) {
  const A = playerTokens(input), B = playerTokens(target);
  if (!_tokensMatch(A, B)) return false;
  if (Array.isArray(squad) && squad.length) {
    let cnt = 0;
    for (const s of squad) { if (_tokensMatch(A, playerTokens(s))) { if (++cnt >= 2) return false; } }
  }
  return true;
}

export function calculatePointsForMatch(pred, actual) {
  if (!pred || !actual) return { total: 0, outcomeCorrect: false, exactScore: false, bestPlayerCorrect: false };

  // Treat empty string as missing score (not as 0)
  if (pred.home === "" || pred.away === "") {
    return { total: 0, outcomeCorrect: false, exactScore: false, bestPlayerCorrect: false };
  }

  const homePred = Number(pred.home);
  const awayPred = Number(pred.away);
  const homeAct = Number(actual.home);
  const awayAct = Number(actual.away);

  if ([homePred, awayPred, homeAct, awayAct].some(Number.isNaN)) {
    return { total: 0, outcomeCorrect: false, exactScore: false, bestPlayerCorrect: false };
  }

  const predOutcome = homePred === awayPred ? "draw" : homePred > awayPred ? "home" : "away";
  const actOutcome = homeAct === awayAct ? "draw" : homeAct > awayAct ? "home" : "away";

  const outcomeCorrect = predOutcome === actOutcome;
  const exactScore = homePred === homeAct && awayPred === awayAct;
  // actual.bestPlayer can be a string (admin entry) or array (auto-detected, may have ties)
  const targets = Array.isArray(actual.bestPlayer) ? actual.bestPlayer : (actual.bestPlayer ? [actual.bestPlayer] : []);
  const squad = Array.isArray(actual.squad) ? actual.squad : [];
  const bestPlayerCorrect = targets.length > 0 && targets.some(t => playerNamesMatch(pred.bestPlayer, t, squad));

  // OTS-30: исход и точный счёт СУММИРУЮТСЯ (точный ⇒ исход тоже верен).
  const g = STAGE_POINTS.group;
  let total = 0;
  if (outcomeCorrect)    total += g.outcome;
  if (exactScore)        total += g.exact;
  if (bestPlayerCorrect) total += g.player;

  return { total, outcomeCorrect, exactScore, bestPlayerCorrect };
}

export function calculateOutrightsPoints(playerOutrights, actualOutrights) {
  if (!playerOutrights || !actualOutrights) return 0;
  const eq = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
  let total = 0;
  if (eq(playerOutrights.winner, actualOutrights.winner)) total += 8;
  if (eq(playerOutrights.bestPlayer, actualOutrights.bestPlayer)) total += 8;
  if (eq(playerOutrights.topScorer, actualOutrights.topScorer)) total += 5;
  // Dark horse: 3 picks, +3 per correct team
  const playerDH = parseDarkHorse(playerOutrights.darkHorse);
  const actualDH = parseDarkHorse(actualOutrights.darkHorse);
  for (const t of playerDH) {
    if (actualDH.some((a) => eq(a, t))) total += 3;
  }
  return total;
}

// OTS-21: кто прошёл дальше в плей-офф. Если счёт (без пенальти) решающий — победитель
// очевиден; при ничьей (ушли в пенальти) берём явный вердикт админа (actual.winner).
function resolveWinner(match, homeAct, awayAct, adminEntry) {
  if (adminEntry?.winner) return adminEntry.winner;
  const ah = Number(homeAct), aa = Number(awayAct);
  if (!Number.isNaN(ah) && !Number.isNaN(aa) && ah !== aa) {
    return ah > aa ? match.home : match.away;
  }
  return "";
}

// Returns the actual result for a match, preferring API-provided scores for ended matches.
// bestPlayer still comes from admin-entered data (no API source for it).
export function resolveActualResult(match) {
  const adminEntry = state.actualMatches?.[match.id];
  const s = Number(match.status);
  if (s >= 8 && match.homeScore != null && match.awayScore != null) {
    return {
      home: String(match.homeScore),
      away: String(match.awayScore),
      // admin override → auto-detected from API ratings → empty
      bestPlayer: adminEntry?.bestPlayer || match.autoBestPlayer || "",
      // OTS-73: состав матча (для отсева неоднозначных совпадений по фамилии)
      squad: Array.isArray(match.players) ? match.players : [],
      winner: resolveWinner(match, match.homeScore, match.awayScore, adminEntry),
      penalties: adminEntry?.penalties || "",
      // OTS-47: счёт серии пенальти (авто из API) — для отображения «пен X:Y»
      penHome: adminEntry?.penHome || "",
      penAway: adminEntry?.penAway || "",
    };
  }
  if (adminEntry) {
    return {
      ...adminEntry,
      squad: Array.isArray(match.players) ? match.players : [],
      winner: resolveWinner(match, adminEntry.home, adminEntry.away, adminEntry),
    };
  }
  return null;
}

// OTS-47: матч показываем как ФИНАЛЬНЫЙ результат только когда исход полностью
// определён. Провайдер sstats ставит status 8 ("Finished") лишь после основного +
// доп. времени + пенальти (доп. время — статус 6, серия пенальти — 7, оба держатся
// как live). НО апи не отдаёт счёт серии пенальти: при ничьей в осн.+доп. FT-счёт
// остаётся ничейным (напр. 1:1), и кто прошёл дальше — решает админ (OTS-21). Пока
// этого нет, «результат» неполон (счёт без прошедшего), поэтому не выводим его как
// финальный — матч висит в актуальных, ждёт исхода. Для группы / решающего счёта
// статуса 8 достаточно.
export function isMatchResultFinal(match) {
  if (Number(match.status) < 8) return false;             // ещё идёт (вкл. доп.время/пенальти)
  if (!classifyKnockoutRound(match.group)) return true;   // группа — счёт самодостаточен
  const h = Number(match.homeScore), a = Number(match.awayScore);
  if (Number.isFinite(h) && Number.isFinite(a) && h !== a) return true;  // решающий счёт → прошедший очевиден
  return Boolean(state.actualMatches?.[match.id]?.winner); // ничья → нужен явный исход (пенальти) от админа
}

// Фаза матча для UI: 'upcoming' | 'live' | 'ended'.
// OTS-47: «live» = матч ИДЁТ (status 3–7) ИЛИ отыгран, но исход ещё не финален
// (ничья плей-офф, ждём пенальти). «ended» только когда результат финален.
export function getMatchPhase(match) {
  const s = Number(match.status);
  if (!s || s <= 2) return "upcoming";
  if (!isMatchResultFinal(match)) return "live";
  return "ended";
}

// OTS-56 (правка автора): «Матчи сёдня» = ВСЕ активные матчи, отсортированные по
// дате начала. Активный = не завершённый: upcoming + live (идёт) + «ждём исход»
// (status≥8, но плей-офф-исход ещё не зафиксирован — это тоже live-фаза, OTS-47).
// Концепция: тут не теряется НИ ОДИН матч — всё, что ещё актуально, видно.
// Идущие/ждущие исхода матчи стартовали раньше upcoming, поэтому при сортировке
// по kickoff естественно оказываются выше. ИНВАРИАНТ (tests/test_today_matches.mjs):
// любой не-завершённый матч ОБЯЗАН быть в этом списке.
export function buildTodayMatches(matches) {
  return (matches || [])
    .filter((m) => getMatchPhase(m) !== "ended")
    .sort((a, b) => String(a.dateTimeRaw).localeCompare(String(b.dateTimeRaw)));
}

// ── Playoff bracket ───────────────────────────────────────────────────────────
// Knockout round detected from the match's `group` label (sstats `roundName`).
// Order matters: "quarter-final"/"semi-final" both contain "final", so those are
// checked before the bare "final". Real values seen live: "Round of 32".
export function classifyKnockoutRound(group) {
  const g = (group || "").toLowerCase();
  if (g.includes("round of 32") || g.includes("1/16")) return "R32";
  if (g.includes("round of 16") || g.includes("1/8"))  return "R16";
  if (g.includes("quarter")     || g.includes("1/4"))  return "QF";
  if (g.includes("semi")        || g.includes("1/2"))  return "SF";
  if (g.includes("final"))                             return "F";
  return null;
}

// OTS-30: плоские таблицы очков по этапам — БЕЗ эскалирующего бонуса (его убрали,
// слишком путал). Исход и точный счёт СУММИРУЮТСЯ (раньше точный заменял исход),
// игрок отдельно. Чем глубже раунд — тем дороже матч. Зеркало _STAGE_POINTS в
// server.py (golden-тесты сверяют значения).
export const STAGE_POINTS = {
  group: { outcome: 1, exact: 2, player: 2 },
  R32:   { outcome: 2, exact: 4, player: 3 },
  R16:   { outcome: 2, exact: 4, player: 3 },
  QF:    { outcome: 3, exact: 5, player: 4 },
  SF:    { outcome: 3, exact: 5, player: 4 },
  F:     { outcome: 4, exact: 6, player: 5 },
};

export function stagePoints(group) {
  return STAGE_POINTS[classifyKnockoutRound(group)] || STAGE_POINTS.group;
}

// Сумма очков игрока ТОЛЬКО за матчи плей-офф (для бэйджа на сетке). Раньше это
// был «бонус за сетку»; теперь бонуса нет — показываем реальные очки плей-офф.
export function calculateBracketBonus(user) {
  let total = 0;
  for (const match of activeMatches) {
    if (!classifyKnockoutRound(match.group)) continue;
    total += matchPointsFor(user.matches?.[match.id], match).total;
  }
  return total;
}

// Points a single match is worth to a prediction по плоской таблице этапа.
// `total` — полные очки матча (исход + точный счёт + игрок, всё суммируется).
//
// OTS-21/OTS-27: в плей-офф «исход» — это «кто пройдёт дальше». Берём явный пик
// pred.advance, а если его нет — выводим из предсказанного счёта (как в группе),
// чтобы игрок, заполнивший только счёт, получал очко за угаданный исход. Точный
// счёт считается по осн.+доп. без серии пенальти.
function teamsEq(a, b) {
  return Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// OTS-27: кого игрок назначил победителем плей-офф-матча. Источник истины — явный
// пик «кто пройдёт» (pred.advance); если его нет — выводим из предсказанного счёта
// (решающий счёт → победившая команда), ровно как исход в групповом этапе. Так
// игрок, заполнивший только счёт, не теряет очко за угаданный исход.
export function predictedAdvance(pred, match) {
  if (pred?.advance) return pred.advance;
  if (!pred || pred.home === "" || pred.away === "") return "";
  const h = Number(pred.home), a = Number(pred.away);
  if (Number.isNaN(h) || Number.isNaN(a)) return "";
  if (h > a) return match.home;
  if (a > h) return match.away;
  return ""; // предсказана ничья — победитель не выбран
}

export function matchPointsFor(pred, match) {
  const actual = resolveActualResult(match);
  const base = calculatePointsForMatch(pred, actual);
  const round = classifyKnockoutRound(match.group);
  const pts = STAGE_POINTS[round] || STAGE_POINTS.group;
  if (!round) {
    // групповой этап — calculatePointsForMatch уже посчитал по групповой таблице
    return { ...base, bonus: 0, total: base.total };
  }
  // плей-офф: исход = угадан ли прошедший дальше (пик advance или вывод из счёта);
  // точный счёт и исход суммируются, игрок отдельно.
  const advanceCorrect = teamsEq(predictedAdvance(pred, match), actual?.winner);
  const exact  = base.exactScore;
  const player = base.bestPlayerCorrect;
  const total = (advanceCorrect ? pts.outcome : 0) + (exact ? pts.exact : 0) + (player ? pts.player : 0);
  return {
    outcomeCorrect: advanceCorrect,
    exactScore: exact,
    bestPlayerCorrect: player,
    bonus: 0,
    total,
  };
}

export function getUserTotalPoints(user) {
  let total = 0;
  // matchPointsFor — единый источник правды по матчу: даёт базу + бонус плей-офф и
  // в плей-офф считает исход по «кто прошёл» (pred.advance), а не по счёту.
  for (const match of activeMatches) {
    total += matchPointsFor(user.matches?.[match.id], match).total;
  }
  total += calculateOutrightsPoints(user.outrights, state.actualOutrights);
  total += user.bonusPoints || 0;
  return total;
}

// Только очки за матчи плей-офф (база + бонус за раунд). Ауткрайты и групповой этап не учитываются.
export function getUserPlayoffPoints(user) {
  let total = 0;
  for (const match of activeMatches) {
    if (!classifyKnockoutRound(match.group)) continue;
    total += matchPointsFor(user.matches?.[match.id], match).total;
  }
  return total;
}

// Стартовал ли плей-офф? true, как только у хотя бы одного knockout-матча есть
// фактический результат. Пока false — показываем приятный пустой стейт вместо
// голого списка нулей.
export function playoffHasStarted() {
  return activeMatches.some(
    (m) => classifyKnockoutRound(m.group) && resolveActualResult(m)
  );
}
