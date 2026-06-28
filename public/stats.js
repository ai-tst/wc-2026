import { state, currentUser, activeMatches } from "./store.js";
import { escapeHtml } from "./utils.js";
import { calculatePointsForMatch, resolveActualResult, getUserTotalPoints } from "./points.js";

// Collapsible stats block (v2). Tabs: "Гонка" (interactive cumulative line chart)
// and "Точность" (hit-rate table + your points distribution).
const CH = { W: 640, H: 260, padL: 30, padR: 102, padT: 14, padB: 26 };
let _statsView = "race";
let _raceMode = "line"; // "line" (cumulative chart) | "bars" (standings histogram)
let _race = null;      // cached geometry/data for hover
let _selected = null;  // Set of nicks currently plotted on the race chart

const RACE_MODES = [["line", "📈 Линия"], ["bars", "📊 Бары"]];
const trimNick = (s) => (s.length > 11 ? s.slice(0, 10) + "…" : s);
const raceModeTabs = () => `<div class="stats-tabs stats-tabs--sub">` + RACE_MODES.map(([k, l]) =>
  `<button type="button" class="stats-tab stats-tab--sm ${_raceMode === k ? "stats-tab--on" : ""}" data-mode="${k}">${l}</button>`).join("") + `</div>`;

const dayKey   = (m) => ((m.dateTimeRaw || "").slice(0, 10)) || m.date || "";
const dayLabel = (k) => { const p = String(k).split("-"); return p[2] && p[1] ? `${p[2]}.${p[1]}` : k; };

export function renderStats() {
  const host = document.getElementById("stats-content");
  if (!host) return;

  const users = state.users || [];
  const ended = (activeMatches || []).filter((m) => Number(m.status) >= 8);
  if (users.length < 2 || !ended.length) {
    host.innerHTML = `<p class="muted small">Статистика подтянется, когда сыграют первые матчи.</p>`;
    return;
  }

  const actuals = {};
  ended.forEach((m) => { actuals[m.id] = resolveActualResult(m); });

  const tabs = [["race", "🏁 Гонка"], ["streaks", "🔥 Стрики"], ["acc", "🎯 Точность"]];
  const tabsHtml = `<div class="stats-tabs">${tabs.map(([k, l]) =>
    `<button type="button" class="stats-tab ${_statsView === k ? "stats-tab--on" : ""}" data-view="${k}">${l}</button>`).join("")}</div>`;

  let body;
  if (_statsView === "acc") body = accuracyView(users, ended, actuals);
  else if (_statsView === "streaks") body = streaksView(users, ended, actuals);
  else body = raceView(users, ended, actuals);
  host.innerHTML = tabsHtml + body;

  host.querySelectorAll(".stats-tab[data-view]").forEach((btn) =>
    btn.addEventListener("click", () => { _statsView = btn.dataset.view; renderStats(); }));

  if (_statsView === "race") {
    host.querySelectorAll(".stats-tab[data-mode]").forEach((btn) =>
      btn.addEventListener("click", () => { _raceMode = btn.dataset.mode; renderStats(); }));
    if (_raceMode === "line") {
      attachRaceHover(host);
      host.querySelectorAll(".legend-chip").forEach((btn) => btn.addEventListener("click", () => {
        const nick = btn.dataset.nick;
        if (_selected.has(nick)) _selected.delete(nick); else _selected.add(nick);
        renderStats();
      }));
    }
  }
}

// ── Гонка: cumulative points line chart with hover scrubber ───────────────────
function raceView(users, ended, actuals) {
  const days  = [...new Set(ended.map(dayKey))].filter(Boolean).sort();
  const byDay = {};
  ended.forEach((m) => { const k = dayKey(m); (byDay[k] = byDay[k] || []).push(m); });

  const series = users.map((u) => {
    let cum = 0; const pts = [];
    days.forEach((d) => {
      let dp = 0;
      byDay[d].forEach((m) => { dp += calculatePointsForMatch(u.matches?.[m.id], actuals[m.id]).total; });
      cum += dp; pts.push(cum);
    });
    // Очки, не привязанные к матчам в графике (ручные баллы + ауткрайты + бонус сетки),
    // чтобы итог Гонки сходился с «итоговой таблицей» (getUserTotalPoints). Раскидываем
    // ровным сдвигом по всей линии — у нас нет даты, к которой их привязать.
    const extra = getUserTotalPoints(u) - cum;
    const adj = pts.map((p) => p + extra);
    return { nick: u.nickname, pts: adj, total: cum + extra, isMe: u.nickname === currentUser?.nickname };
  });

  const ranked = [...series].sort((a, b) => b.total - a.total);
  const defaults = new Set(ranked.slice(0, 6).map((s) => s.nick));
  if (currentUser?.nickname) defaults.add(currentUser.nickname);
  if (_selected === null) _selected = new Set(defaults);
  let show = ranked.filter((s) => _selected.has(s.nick));
  if (!show.length) show = ranked.filter((s) => defaults.has(s.nick));

  const { W, H, padL, padR, padT, padB } = CH;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = days.length;
  const xFor = (i) => padL + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const maxY = Math.max(1, ...show.map((s) => s.pts[n - 1] || 0));
  const yFor = (v) => padT + plotH - (v / maxY) * plotH;

  const palette = ["#38bdf8", "#f472b6", "#a78bfa", "#fb923c", "#4ade80", "#f87171", "#22d3ee"];
  let ci = 0;
  const colored = [...show.filter((s) => !s.isMe), ...show.filter((s) => s.isMe)]
    .map((s) => ({ ...s, color: s.isMe ? "#ffd23f" : palette[(ci++) % palette.length] }));

  let grid = "";
  for (let k = 0; k <= 4; k++) {
    const v = Math.round((maxY * k) / 4), y = yFor(v);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(168,163,212,0.15)"/>`;
    grid += `<text x="${padL - 5}" y="${y + 3}" text-anchor="end" font-size="9" fill="#a9a3d4">${v}</text>`;
  }
  const step = Math.max(1, Math.ceil(n / 6));
  let xlabels = "";
  days.forEach((d, i) => {
    if (i % step === 0 || i === n - 1)
      xlabels += `<text x="${xFor(i)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#a9a3d4">${escapeHtml(dayLabel(d))}</text>`;
  });

  let lines = "";
  colored.forEach((s) => {
    const pts = s.pts.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(" ");
    lines += `<polyline fill="none" stroke="${s.color}" stroke-width="${s.isMe ? 3.4 : 2}" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
  });

  // end labels with vertical collision avoidance
  const lx = xFor(n - 1);
  const ends = colored.map((s) => ({ color: s.color, nick: s.nick, val: s.pts[n - 1] || 0, isMe: s.isMe, y: yFor(s.pts[n - 1] || 0) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  let endLabels = "";
  colored.forEach((s) => { endLabels += `<circle cx="${lx}" cy="${yFor(s.pts[n - 1] || 0)}" r="${s.isMe ? 3.4 : 2.4}" fill="${s.color}"/>`; });
  ends.forEach((e) => { endLabels += `<text x="${lx + 7}" y="${e.y + 3}" font-size="10" font-weight="${e.isMe ? 800 : 600}" fill="${e.color}">${escapeHtml(e.nick)} ${e.val}</text>`; });

  const scrub = `<line class="stats-scrub" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="rgba(255,255,255,0.45)" stroke-dasharray="3 3" style="opacity:0"/>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="stats-chart" preserveAspectRatio="xMidYMid meet">${grid}${xlabels}${lines}${endLabels}${scrub}</svg>`;

  // blurbs
  let exactKing = { nick: "—", c: -1 }, bpKing = { nick: "—", c: -1 }, bestDay = { nick: "—", v: -1, day: "" };
  users.forEach((u) => {
    let ex = 0, bp = 0;
    days.forEach((d) => {
      let dp = 0;
      byDay[d].forEach((m) => {
        const r = calculatePointsForMatch(u.matches?.[m.id], actuals[m.id]);
        if (r.exactScore) ex++; if (r.bestPlayerCorrect) bp++; dp += r.total;
      });
      if (dp > bestDay.v) bestDay = { nick: u.nickname, v: dp, day: d };
    });
    if (ex > exactKing.c) exactKing = { nick: u.nickname, c: ex };
    if (bp > bpKing.c) bpKing = { nick: u.nickname, c: bp };
  });
  const blurb = (e, t, v) => `<div class="stats-blurb"><span class="sb-emoji">${e}</span><div><div class="sb-title">${t}</div><div class="sb-val">${v}</div></div></div>`;
  const blurbs = `<div class="stats-blurbs">
      ${blurb("🎯", "Король точных счётов", `${escapeHtml(exactKing.nick)} · ${Math.max(0, exactKing.c)} шт.`)}
      ${blurb("⭐", "Лучше всех чует MVP", `${escapeHtml(bpKing.nick)} · ${Math.max(0, bpKing.c)} шт.`)}
      ${blurb("🔥", "Рекорд очков за день", `${escapeHtml(bestDay.nick)} · +${Math.max(0, bestDay.v)} (${escapeHtml(dayLabel(bestDay.day))})`)}
    </div>`;

  const colorByNick = {};
  colored.forEach((s) => { colorByNick[s.nick] = s.color; });
  const legend = `<div class="stats-legend">` + ranked.map((s) => {
    const on = _selected.has(s.nick);
    const col = on ? (colorByNick[s.nick] || "#9ca3af") : "#4b4763";
    return `<button type="button" class="legend-chip ${on ? "" : "legend-chip--off"}" data-nick="${escapeHtml(s.nick)}"><span class="legend-dot" style="background:${col}"></span>${escapeHtml(s.nick)}</button>`;
  }).join("") + `</div>`;

  _race = { days, colored, n, geom: { W, padL, plotW } };

  const header = `<div class="stats-title">Гонка за очки <span class="muted small">${_raceMode === "bars"
    ? "(сумма очков · кто на каком месте)"
    : "(наведи — у кого сколько · тыкай ники, чтоб скрыть/показать)"}</span></div>${raceModeTabs()}`;
  if (_raceMode === "bars") return header + barsView(ranked) + blurbs;
  return header +
    `<div class="stats-chart-wrap"><div class="stats-tip" style="display:none"></div>${svg}</div>${legend}${blurbs}`;
}

// ── Гонка · режим гистограммы: горизонтальные бары итоговых очков (текущие места)
function barsView(ranked) {
  const { W } = CH;
  const labelW = 108, padTop = 6, padRight = 46, padBot = 22;
  const rowH = ranked.length > 12 ? 22 : 26;
  const barH = Math.min(18, rowH - 9);
  const plotW = W - labelW - padRight;
  const H = padTop + ranked.length * rowH + padBot;
  const maxT = Math.max(1, ranked[0]?.total || 0);
  const palette = ["#38bdf8", "#f472b6", "#a78bfa", "#fb923c", "#4ade80", "#f87171", "#22d3ee"];
  let ci = 0;

  // вертикальная сетка + шкала очков снизу
  let grid = "";
  for (let k = 0; k <= 4; k++) {
    const v = Math.round((maxT * k) / 4);
    const x = labelW + (plotW * k) / 4;
    grid += `<line x1="${x.toFixed(1)}" y1="${padTop}" x2="${x.toFixed(1)}" y2="${(padTop + ranked.length * rowH).toFixed(1)}" stroke="rgba(168,163,212,0.12)"/>`;
    grid += `<text x="${x.toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="9" fill="#a9a3d4">${v}</text>`;
  }

  let bars = "";
  ranked.forEach((s, i) => {
    const color = s.isMe ? "#ffd23f" : palette[(ci++) % palette.length];
    const cy = padTop + i * rowH + rowH / 2;
    const bw = Math.max(2, (s.total / maxT) * plotW);
    const yTop = (cy - barH / 2).toFixed(1);
    bars += `<rect x="${labelW}" y="${yTop}" width="${bw.toFixed(1)}" height="${barH}" rx="4" fill="${color}" fill-opacity="${s.isMe ? 1 : 0.85}"${s.isMe ? ' stroke="#fff7d6" stroke-width="1"' : ""}/>`;
    bars += `<text x="${labelW - 6}" y="${(cy + 3.5).toFixed(1)}" text-anchor="end" font-size="10" font-weight="${s.isMe ? 800 : 600}" fill="${color}">${i + 1}. ${escapeHtml(trimNick(s.nick))}</text>`;
    bars += `<text x="${(labelW + bw + 5).toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" font-size="10" font-weight="700" fill="${color}">${s.total}</text>`;
  });

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="stats-chart" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
  return `<div class="stats-chart-wrap">${svg}</div>`;
}

function attachRaceHover(host) {
  const wrap = host.querySelector(".stats-chart-wrap");
  if (!wrap || !_race) return;
  const svg  = wrap.querySelector("svg");
  const tip  = wrap.querySelector(".stats-tip");
  const scrub = svg.querySelector(".stats-scrub");
  const { days, colored, n, geom } = _race;

  const move = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const sx = geom.W / rect.width;
    const mxVb = (clientX - rect.left) * sx;
    let i = Math.round((mxVb - geom.padL) / (n <= 1 ? 1 : geom.plotW / (n - 1)));
    i = Math.max(0, Math.min(n - 1, i));
    const xVb = geom.padL + (n <= 1 ? geom.plotW / 2 : (i * geom.plotW) / (n - 1));
    scrub.setAttribute("x1", xVb); scrub.setAttribute("x2", xVb); scrub.style.opacity = "1";

    const rows = colored.map((s) => ({ nick: s.nick, color: s.color, val: s.pts[i] || 0 }))
      .sort((a, b) => b.val - a.val);
    tip.innerHTML = `<div class="tip-day">${escapeHtml(dayLabel(days[i]))}</div>` +
      rows.map((r) => `<div class="tip-row"><span class="tip-dot" style="background:${r.color}"></span><span class="tip-nick">${escapeHtml(r.nick)}</span><span class="tip-val">${r.val}</span></div>`).join("");
    tip.style.display = "block";

    const wr = wrap.getBoundingClientRect();
    let left = clientX - wr.left + 14;
    if (left + tip.offsetWidth > wr.width) left = clientX - wr.left - tip.offsetWidth - 14;
    tip.style.left = Math.max(2, left) + "px";
    tip.style.top  = Math.max(2, clientY - wr.top + 12) + "px";
  };
  const hide = () => { tip.style.display = "none"; if (scrub) scrub.style.opacity = "0"; };

  svg.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
  svg.addEventListener("mouseleave", hide);
  svg.addEventListener("touchstart", (e) => { if (e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  svg.addEventListener("touchmove",  (e) => { if (e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
}

// ── Стрики: текущие и рекордные серии угаданных/слитых ставок ──────────────────
// Стабильные цвета игроков «как в Гонке»: ранжируем по сумме очков, раздаём
// палитру по этому порядку, себе — золотой (тот же маппинг, что дефолт Гонки).
function streakColors(users, ended, actuals) {
  const palette = ["#38bdf8", "#f472b6", "#a78bfa", "#fb923c", "#4ade80", "#f87171", "#22d3ee"];
  const ranked = users.map((u) => (
    { nick: u.nickname, total: getUserTotalPoints(u), isMe: u.nickname === currentUser?.nickname }
  )).sort((a, b) => b.total - a.total);
  const byNick = {};
  let ci = 0;
  ranked.forEach((s) => { byNick[s.nick] = s.isMe ? "#ffd23f" : palette[(ci++) % palette.length]; });
  return byNick;
}

// Подколы по длине серии — чем длиннее, тем громче вайб.
function hotCaption(n) {
  if (n >= 6) return "красный поясок, всё горит 🔥🔥🔥";
  if (n >= 4) return "на кураже, не остановить";
  if (n >= 2) return "разогрелся, идёт волна";
  return "только зажёгся";
}
function coldCaption(n) {
  if (n >= 6) return "лютый даунстрик, пора удалять акк 💀";
  if (n >= 4) return "ловит холодрыгу, занесите плед 🧊";
  if (n >= 2) return "что-то приуныл, мажет подряд";
  return "лёгкий холодок ❄️";
}

function streaksView(users, ended, actuals) {
  // Хронологический порядок матчей (как в брекете): по дате, затем по id.
  const order = [...ended].sort((a, b) =>
    String(a.dateTimeRaw || "").localeCompare(String(b.dateTimeRaw || "")) ||
    String(a.id).localeCompare(String(b.id)));
  const colorByNick = streakColors(users, ended, actuals);

  const rows = users.map((u) => {
    let run = 0, runHit = null, recWin = 0, recLose = 0, settled = 0;
    order.forEach((m) => {
      const pred = u.matches?.[m.id];
      if (!pred || pred.home === "" || pred.home == null) return; // только реальные ставки
      const hit = calculatePointsForMatch(pred, actuals[m.id]).outcomeCorrect; // угадал исход
      settled++;
      if (runHit === hit) run++; else { run = 1; runHit = hit; }
      if (hit && run > recWin) recWin = run;
      if (!hit && run > recLose) recLose = run;
    });
    // текущая серия = хвостовой ран; направление = runHit (true — вин, false — луз)
    return {
      nick: u.nickname, isMe: u.nickname === currentUser?.nickname,
      color: colorByNick[u.nickname], settled,
      cur: settled ? run : 0, curHit: settled ? runHit : null, recWin, recLose,
    };
  });

  // Сортировка-нарратив: самые горячие сверху, самые холодные снизу.
  const heat = (r) => (r.curHit === true ? r.cur : r.curHit === false ? -r.cur : 0);
  rows.sort((a, b) => heat(b) - heat(a) || b.recWin - a.recWin || a.nick.localeCompare(b.nick));

  const hotCands = rows.filter((r) => r.curHit === true && r.cur >= 1)
    .sort((a, b) => b.cur - a.cur || b.recWin - a.recWin || a.nick.localeCompare(b.nick));
  const coldCands = rows.filter((r) => r.curHit === false && r.cur >= 2)
    .sort((a, b) => b.cur - a.cur || b.recLose - a.recLose || a.nick.localeCompare(b.nick));
  const hot = hotCands[0] || null;
  const cold = coldCands[0] || null;

  const dot = (c) => `<span class="sr-dot" style="background:${c}"></span>`;
  const hotHero = hot
    ? `<div class="streak-hero streak-hero--hot">
        <div class="sh-emoji">🔥</div>
        <div class="sh-body">
          <div class="sh-label">Горящий игрок</div>
          <div class="sh-nick">${dot(hot.color)}${escapeHtml(hot.nick)}</div>
          <div class="sh-big">${hot.cur} побед подряд</div>
          <div class="sh-cap">${hotCaption(hot.cur)}</div>
        </div>
      </div>`
    : `<div class="streak-hero streak-hero--hot streak-hero--empty">
        <div class="sh-emoji">🥶</div>
        <div class="sh-body"><div class="sh-label">Горящий игрок</div>
          <div class="sh-cap">Пока никто не разогрелся — все мажут.</div></div>
      </div>`;
  const coldHero = cold
    ? `<div class="streak-hero streak-hero--cold">
        <div class="sh-emoji">${cold.cur >= 5 ? "💀" : "🧊"}</div>
        <div class="sh-body">
          <div class="sh-label">Холодный игрок</div>
          <div class="sh-nick">${dot(cold.color)}${escapeHtml(cold.nick)}</div>
          <div class="sh-big">${cold.cur} мимо подряд</div>
          <div class="sh-cap">${coldCaption(cold.cur)}</div>
        </div>
      </div>`
    : `<div class="streak-hero streak-hero--cold streak-hero--empty">
        <div class="sh-emoji">😎</div>
        <div class="sh-body"><div class="sh-label">Холодный игрок</div>
          <div class="sh-cap">Лютых даунстриков нет — красавчики.</div></div>
      </div>`;

  const list = rows.map((r) => {
    let cur;
    if (r.curHit === true) cur = `<span class="sr-cur sr-cur--hot">🔥 ${r.cur}</span>`;
    else if (r.curHit === false) cur = `<span class="sr-cur sr-cur--cold">🧊 ${r.cur}</span>`;
    else cur = `<span class="sr-cur sr-cur--none">—</span>`;
    const rec = r.recWin > 0
      ? `<span class="sr-rec" title="Лучшая серия побед за всё время">🏆 ${r.recWin}</span>`
      : `<span class="sr-rec sr-rec--zero">🏆 0</span>`;
    return `<div class="streak-row ${r.isMe ? "streak-row--me" : ""}">
        <span class="sr-who">${dot(r.color)}<span class="sr-nick">${escapeHtml(r.nick)}</span></span>
        ${cur}${rec}
      </div>`;
  }).join("");

  return `<div class="stats-title">Стрики <span class="muted small">(серии угаданных исходов подряд · кто на кураже, а кто сливает)</span></div>
    <div class="streak-heroes">${hotHero}${coldHero}</div>
    <div class="streak-list-head"><span>Чел</span><span>Сейчас</span><span>Рекорд</span></div>
    <div class="streak-list">${list}</div>`;
}

// ── Точность: hit-rate table + your points distribution ───────────────────────
function accuracyView(users, ended, actuals) {
  const rows = users.map((u) => {
    let n = 0, exact = 0, outcome = 0, mvp = 0, sum = 0;
    const dist = { perfect: 0, exact: 0, op: 0, player: 0, outcome: 0, miss: 0 };
    ended.forEach((m) => {
      const pred = u.matches?.[m.id];
      if (!pred || pred.home === "" || pred.home == null) return; // only placed bets
      n++;
      const r = calculatePointsForMatch(pred, actuals[m.id]);
      if (r.exactScore) exact++;
      if (r.outcomeCorrect) outcome++;
      if (r.bestPlayerCorrect) mvp++;
      sum += r.total;
      if (r.exactScore && r.bestPlayerCorrect) dist.perfect++;       // +5
      else if (r.exactScore) dist.exact++;                            // +3 точный счёт
      else if (r.outcomeCorrect && r.bestPlayerCorrect) dist.op++;    // +3 исход+игрок
      else if (r.bestPlayerCorrect) dist.player++;                    // +2 только игрок
      else if (r.outcomeCorrect) dist.outcome++;                      // +1 только исход
      else dist.miss++;                                               // 0
    });
    return { nick: u.nickname, isMe: u.nickname === currentUser?.nickname, n, exact, outcome, mvp, sum, avg: n ? sum / n : 0, dist };
  }).filter((r) => r.n > 0).sort((a, b) => b.sum - a.sum);

  const pct = (x, n) => (n ? Math.round((x / n) * 100) : 0);
  const tr = rows.map((r) => `<tr class="${r.isMe ? "acc-me" : ""}">
      <td class="acc-nick">${escapeHtml(r.nick)}</td>
      <td>${r.exact} <span class="muted">· ${pct(r.exact, r.n)}%</span></td>
      <td>${r.outcome} <span class="muted">· ${pct(r.outcome, r.n)}%</span></td>
      <td>${r.mvp} <span class="muted">· ${pct(r.mvp, r.n)}%</span></td>
      <td>${r.avg.toFixed(2)}</td>
    </tr>`).join("");

  const me = rows.find((r) => r.isMe);
  let distHtml = "";
  if (me) {
    const order = [
      ["perfect", "+5", "перфект", "dist-5"],
      ["exact", "+3", "точный счёт", "dist-3"],
      ["op", "+3", "исход + игрок", "dist-3"],
      ["player", "+2", "только игрок", "dist-2"],
      ["outcome", "+1", "только исход", "dist-1"],
      ["miss", "0", "мимо", "dist-0"],
    ];
    distHtml = `<div class="stats-title" style="margin-top:16px">Твоё распределение <span class="muted small">(из ${me.n} ставок)</span></div>
      <div class="acc-dist">` + order.map(([k, lbl, sub, cls]) =>
        `<div class="dist-chip ${cls}"><div class="dist-num">${me.dist[k] || 0}</div><div class="dist-lbl">${lbl}</div><div class="dist-pct">${pct(me.dist[k] || 0, me.n)}%</div><div class="dist-sub">${sub}</div></div>`).join("") + `</div>`;
  }

  return `<div class="stats-title">Точность прогнозов <span class="muted small">(по сыгранным ставкам)</span></div>
    <div class="admin-table-wrapper"><table class="admin-table acc-table">
      <thead><tr><th>Чел</th><th>Точный счёт</th><th>Исход</th><th>Лучший игрок</th><th>Очк/матч</th></tr></thead>
      <tbody>${tr}</tbody></table></div>${distHtml}`;
}
