import { state, currentUser } from "./store.js";
import { $, escapeHtml } from "./utils.js";
import { getUserTotalPoints, getUserPlayoffPoints } from "./points.js";

function buildRows(users, getPoints) {
  return users
    .filter((u) => u.onboardingComplete)
    .map((u) => ({ nickname: u.nickname, total: getPoints(u) }))
    .sort((a, b) => b.total - a.total);
}

function renderTable(tbodyId, rows) {
  const tbody = $(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = "";
  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    if (row.nickname === currentUser?.nickname) tr.classList.add("scoreboard-row--me");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><button class="player-link" data-player-nick="${escapeHtml(row.nickname)}">${escapeHtml(row.nickname)}</button></td>
      <td>${row.total}</td>`;
    tbody.appendChild(tr);
  });
}

export function renderScoreboard() {
  const users = state.users;

  // Playoff table (main)
  renderTable("scoreboard-playoff-body", buildRows(users, getUserPlayoffPoints));

  // Full table (group + all)
  renderTable("scoreboard-body", buildRows(users, getUserTotalPoints));
}
