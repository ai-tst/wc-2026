import { state, currentUser } from "./store.js";
import { $, escapeHtml } from "./utils.js";
import { getUserTotalPoints, getUserPlayoffPoints, playoffHasStarted } from "./points.js";

// OTS-96: пул фраз «печати позора» для забивших. Держим в одном месте — легко
// пополнять. Выбор детерминированный по нику (стабилен, не мельтешит; у разных
// людей разный). Синхронен с ROAST_BADGES на бэке (server.py) — пополняй оба.
const ROAST_BADGES = [
  "ОТСОСАЛ", "СЛИЛСЯ", "ЗАССАЛ ЧМ", "ГДЕ СТАВКИ?", "СДУЛСЯ", "ЗАБИЛ БОЛТ",
];

function roastFor(nickname) {
  let h = 0;
  for (let i = 0; i < nickname.length; i++) h = (h * 31 + nickname.charCodeAt(i)) >>> 0;
  return ROAST_BADGES[h % ROAST_BADGES.length];
}

function buildRows(users, getPoints) {
  return users
    .filter((u) => u.onboardingComplete)
    .map((u) => ({ nickname: u.nickname, total: getPoints(u), inactive: !!u.inactive }))
    .sort((a, b) => b.total - a.total);
}

function renderTable(tbodyId, rows) {
  const tbody = $(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = "";
  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    if (row.nickname === currentUser?.nickname) tr.classList.add("scoreboard-row--me");
    const roast = row.inactive
      ? ` <span class="scoreboard-roast" title="Давно не ставит — вернись в игру!">${escapeHtml(roastFor(row.nickname))}</span>`
      : "";
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><span class="scoreboard-name"><button class="player-link" data-player-nick="${escapeHtml(row.nickname)}">${escapeHtml(row.nickname)}</button>${roast}</span></td>
      <td>${row.total}</td>`;
    tbody.appendChild(tr);
  });
}

export function renderScoreboard() {
  const users = state.users;

  // Playoff table (main, in focus) — очки только за матчи плей-офф, у всех с нуля.
  renderTable("scoreboard-playoff-body", buildRows(users, getUserPlayoffPoints));

  // Группа (легаси, в фоне, свёрнута) — текущая итоговая таблица, ачивки сохранены.
  renderTable("scoreboard-body", buildRows(users, getUserTotalPoints));

  // Пустой стейт плей-офф: показываем, пока ни один матч на вылет не сыгран.
  $("playoff-empty-state")?.classList.toggle("hidden", playoffHasStarted());
}
