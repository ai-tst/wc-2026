export const OUTRIGHTS_EDIT_DEADLINE = new Date(2026, 5, 12, 23, 59, 59);

// All 48 WC 2026 participants (dark horses ∪ contenders), sorted alphabetically
export const WC_TEAMS = [
  // Contenders (22)
  "Австралия", "Австрия", "Англия", "Аргентина", "Бельгия",
  "Бразилия", "Германия", "Испания", "Колумбия", "Марокко",
  "Мексика", "Нидерланды", "Норвегия", "Португалия",
  "США", "Уругвай", "Франция", "Хорватия", "Швейцария",
  "Швеция", "Южная Корея", "Япония",
  // Dark horses (26)
  "Алжир", "Босния и Герцеговина", "Гаити", "Гана", "ДР Конго",
  "Египет", "Иордания", "Иран", "Ирак", "Кабо-Верде",
  "Канада", "Катар", "Кот-д'Ивуар", "Кюрасао", "Новая Зеландия",
  "Панама", "Парагвай", "Саудовская Аравия", "Сенегал", "Тунис",
  "Турция", "Узбекистан", "Чехия", "Шотландия", "Эквадор", "ЮАР",
].sort((a, b) => a.localeCompare(b, "ru"));

export const DARK_HORSE_TEAMS = [
  "ЮАР", "Чехия", "Канада", "Босния и Герцеговина", "Катар",
  "Гаити", "Шотландия", "Парагвай", "Турция", "Кюрасао",
  "Кот-д'Ивуар", "Эквадор", "Тунис", "Египет", "Иран",
  "Новая Зеландия", "Кабо-Верде", "Саудовская Аравия", "Сенегал",
  "Ирак", "Алжир", "Иордания", "ДР Конго", "Узбекистан", "Гана", "Панама",
];

export function emptyOutrights() {
  return { winner: "", bestPlayer: "", topScorer: "", darkHorse: "" };
}

// In-memory state — populated from server on init / leaderboard refresh
export const state = {
  users:           [],
  actualMatches:   {},
  actualOutrights: emptyOutrights(),
};

export function updateStateFromServer({ users, actualMatches, actualOutrights }) {
  if (users)           state.users           = users;
  if (actualMatches)   state.actualMatches   = actualMatches;
  if (actualOutrights) state.actualOutrights = actualOutrights;
}

export let currentUser = null;
export function setCurrentUser(u) { currentUser = u; }

export let activeMatches = [];
export function setActiveMatches(m) { activeMatches = m; }

export let fixturesLoaded = false;
export function setFixturesLoaded(v) { fixturesLoaded = v; }

// true, когда провайдер данных лёг и матчи отданы из фолбэк-кэша (неполные)
export let matchesDegraded = false;
export function setMatchesDegraded(v) { matchesDegraded = v; }
