const teamCache = {};

export async function fetchMatchesFromSportDb(dateOverride) {
  const url = dateOverride ? `/api/matches?date=${encodeURIComponent(dateOverride)}` : "/api/matches";
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  return {
    matches: Array.isArray(data) ? data : [],
    total: Array.isArray(data) ? data.length : 0,
  };
}

export async function getTeamPlayers(teamId) {
  if (teamCache[teamId]) return teamCache[teamId];
  const res = await fetch(`/api/team/${teamId}`);
  const data = await res.json();
  const players = data?.data?.players || [];
  teamCache[teamId] = players;
  return players;
}
