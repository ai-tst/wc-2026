async function req(method, path, body) {
  const opts = {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const get  = path        => req("GET",  path);
const post = (path, b)   => req("POST", path, b);
const put  = (path, b)   => req("PUT",  path, b);

// Auth
export const apiRegister = data  => post("/api/auth/register", data);
export const apiLogin    = (nickname, password) => post("/api/auth/login", { nickname, password });
export const apiLogout   = ()    => post("/api/auth/logout");
export const apiMe       = ()    => get("/api/auth/me");
export const apiSetDesignVersion = version => put("/api/me/design-version", { version });

// Outrights (user long-term picks)
export const apiGetOutrights  = ()    => get("/api/outrights");
export const apiSaveOutrights = data  => put("/api/outrights", data);

// Match predictions
export const apiGetPredictions  = ()              => get("/api/predictions");
export const apiSavePrediction  = (matchId, data) => put(`/api/predictions/${matchId}`, data);

// Actual results (admin)
export const apiGetActualOutrights  = ()    => get("/api/actual/outrights");
export const apiSaveActualOutrights = data  => put("/api/actual/outrights", data);
export const apiSaveActualMatch     = (matchId, data) => put(`/api/actual/match/${matchId}`, data);

// Leaderboard (returns { users, actualMatches, actualOutrights })
export const apiGetLeaderboard = () => get("/api/leaderboard");

// Player ratings for a completed match { playerName: rating }
export const apiGetMatchRatings = (matchId) => get(`/api/match-ratings/${matchId}`);
