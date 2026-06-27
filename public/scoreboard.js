import { state, currentUser } from "./store.js";
import { $, escapeHtml } from "./utils.js";
import { getUserTotalPoints } from "./points.js";

export function renderScoreboard() {
  const tbody = $("scoreboard-body");
  tbody.innerHTML = "";

  const rows = state.users
    .filter((u) => u.onboardingComplete)
    .map((u) => ({ nickname: u.nickname, total: getUserTotalPoints(u) }))
    .sort((a, b) => b.total - a.total);

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
