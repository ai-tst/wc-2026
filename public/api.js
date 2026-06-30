const teamCache = {};

export async function fetchMatchesFromSportDb(dateOverride) {
  const url = dateOverride ? `/api/matches?date=${encodeURIComponent(dateOverride)}` : "/api/matches";
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  return {
    matches: Array.isArray(data) ? data : [],
    total: Array.isArray(data) ? data.length : 0,
    // Бэк выставляет X-Matches-Degraded=1, когда провайдер sstats лёг и
    // отдаётся фолбэк-кэш — данные могут быть неполными/устаревшими.
    degraded: res.headers.get("X-Matches-Degraded") === "1",
  };
}

// OTS-54: полный набор матчей текущего раунда плей-офф (для кнопки «Показать все»).
// Бэк отдаёт complete=false (и пустой matches), если вся сетка раунда ещё не известна.
export async function fetchRoundMatches() {
  const res = await fetch("/api/matches/round");
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}

export async function getTeamPlayers(teamId) {
  if (teamCache[teamId]) return teamCache[teamId];
  const res = await fetch(`/api/team/${teamId}`);
  const data = await res.json();
  const players = data?.data?.players || [];
  teamCache[teamId] = players;
  return players;
}
