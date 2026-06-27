import { state, currentUser, activeMatches } from "./store.js";
import { escapeHtml } from "./utils.js";
import { calculatePointsForMatch, resolveActualResult } from "./points.js";

// Collapsible stats block (v2): a hand-rolled SVG "points race" + fun blurbs.
export function renderStats() {
  const host = document.getElementById("stats-content");
  if (!host) return;

  const users = state.users || [];
  const ended = (activeMatches || []).filter((m) => Number(m.status) >= 8);
  if (users.length < 2 || !ended.length) {
    host.innerHTML = `<p class="muted small">Статистика подтянется, когда сыграют первые матчи.</p>`;
    return;
  }

  const dayKey   = (m) => ((m.dateTimeRaw || "").slice(0, 10)) || m.date || "";
  const dayLabel = (k) => { const p = String(k).split("-"); return p[2] && p[1] ? `${p[2]}.${p[1]}` : k; };
  const days  = [...new Set(ended.map(dayKey))].filter(Boolean).sort();
  const byDay = {};
  ended.forEach((m) => { const k = dayKey(m); (byDay[k] = byDay[k] || []).push(m); });

  const actuals = {};
  ended.forEach((m) => { actuals[m.id] = resolveActualResult(m); });

  // cumulative match-points per user across days
  const series = users.map((u) => {
    let cum = 0; const pts = [];
    days.forEach((d) => {
      let dp = 0;
      byDay[d].forEach((m) => { dp += calculatePointsForMatch(u.matches?.[m.id], actuals[m.id]).total; });
      cum += dp; pts.push(cum);
    });
    return { nick: u.nickname, pts, total: cum, isMe: u.nickname === currentUser?.nickname };
  });

  const ranked = [...series].sort((a, b) => b.total - a.total);
  const show = ranked.slice(0, 6);
  if (!show.some((s) => s.isMe)) { const me = series.find((s) => s.isMe); if (me) show.push(me); }

  // ── chart geometry ──
  const W = 640, H = 260, padL = 30, padR = 84, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = days.length;
  const xFor = (i) => padL + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const maxY = Math.max(1, ...show.map((s) => s.pts[n - 1] || 0));
  const yFor = (v) => padT + plotH - (v / maxY) * plotH;

  const palette = ["#38bdf8", "#f472b6", "#a78bfa", "#fb923c", "#4ade80", "#f87171", "#22d3ee"];
  let ci = 0;
  const colorFor = (s) => (s.isMe ? "#ffd23f" : palette[(ci++) % palette.length]);

  let grid = "";
  for (let k = 0; k <= 4; k++) {
    const v = Math.round((maxY * k) / 4);
    const y = yFor(v);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(168,163,212,0.15)" stroke-width="1"/>`;
    grid += `<text x="${padL - 5}" y="${y + 3}" text-anchor="end" font-size="9" fill="#a9a3d4">${v}</text>`;
  }

  const step = Math.max(1, Math.ceil(n / 6));
  let xlabels = "";
  days.forEach((d, i) => {
    if (i % step === 0 || i === n - 1) {
      xlabels += `<text x="${xFor(i)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#a9a3d4">${escapeHtml(dayLabel(d))}</text>`;
    }
  });

  // draw "me" last so its gold line sits on top
  const ordered = [...show.filter((s) => !s.isMe), ...show.filter((s) => s.isMe)];
  let lines = "";
  ordered.forEach((s) => {
    const col = colorFor(s);
    const pts = s.pts.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(" ");
    lines += `<polyline fill="none" stroke="${col}" stroke-width="${s.isMe ? 3.4 : 2}" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
    const lx = xFor(n - 1), ly = yFor(s.pts[n - 1] || 0);
    lines += `<circle cx="${lx}" cy="${ly}" r="${s.isMe ? 3.6 : 2.6}" fill="${col}"/>`;
    lines += `<text x="${lx + 6}" y="${ly + 3.5}" font-size="10" font-weight="${s.isMe ? 800 : 600}" fill="${col}">${escapeHtml(s.nick)} ${s.pts[n - 1] || 0}</text>`;
  });

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="stats-chart" role="img" aria-label="Гонка за очки">${grid}${xlabels}${lines}</svg>`;

  // ── fun blurbs ──
  let exactKing = { nick: "—", c: -1 }, bpKing = { nick: "—", c: -1 }, bestDay = { nick: "—", v: -1, day: "" };
  users.forEach((u) => {
    let ex = 0, bp = 0;
    days.forEach((d) => {
      let dp = 0;
      byDay[d].forEach((m) => {
        const r = calculatePointsForMatch(u.matches?.[m.id], actuals[m.id]);
        if (r.exactScore) ex++;
        if (r.bestPlayerCorrect) bp++;
        dp += r.total;
      });
      if (dp > bestDay.v) bestDay = { nick: u.nickname, v: dp, day: d };
    });
    if (ex > exactKing.c) exactKing = { nick: u.nickname, c: ex };
    if (bp > bpKing.c) bpKing = { nick: u.nickname, c: bp };
  });

  const blurb = (emoji, title, val) =>
    `<div class="stats-blurb"><span class="sb-emoji">${emoji}</span><div><div class="sb-title">${title}</div><div class="sb-val">${val}</div></div></div>`;

  const blurbs = `
    <div class="stats-blurbs">
      ${blurb("🎯", "Король точных счётов", `${escapeHtml(exactKing.nick)} · ${Math.max(0, exactKing.c)}`)}
      ${blurb("⭐", "Лучше всех чует MVP", `${escapeHtml(bpKing.nick)} · ${Math.max(0, bpKing.c)}`)}
      ${blurb("🔥", "Лучший тур", `${escapeHtml(bestDay.nick)} +${Math.max(0, bestDay.v)} (${escapeHtml(dayLabel(bestDay.day))})`)}
    </div>`;

  host.innerHTML =
    `<div class="stats-title">Гонка за очки <span class="muted small">(по матчам, кумулятивно)</span></div>${svg}${blurbs}`;
}
