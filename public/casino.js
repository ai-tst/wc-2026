// ── Режим казика 🎰 ────────────────────────────────────────────────────────────
// v2-only easter egg. Клик по лого в шапке → золото рекой сыплется со всех сторон,
// обводки карточек переливаются радугой, играет музыка + эквалайзер в шапке, а
// кнопки «Изменить ставку» превращаются в огромную «НАУГАД БЛЯ». Она крутит слот:
// счёт (0–7) двумя барабанами + случайный игрок рядом. Можно поставить или отказаться.

const ORIG_LOGO    = "otsos-logo.png";
const CASINO_LOGO   = "otsos-casino-logo.webp";
const MUSIC_SRC     = "casino-music.mp3";
const REEL_DIGITS   = 8;     // значения 0..7
const REEL_CYCLES   = 14;    // прокруты алфавита цифр до остановки
const COIN_CAP      = 150;   // потолок одновременных монет (защита от джанка)
const COIN_GLYPHS   = ["🪙", "🪙", "🪙", "🪙", "💰", "🟡"];

let casinoOn  = false;
let coinTimer = null;
let audioEl   = null;
let logoEl    = null;

export function isCasinoMode() { return casinoOn; }

export function setupCasino() {
  logoEl = document.querySelector("#view-main .wc-logo--header");
  if (!logoEl) return;
  logoEl.classList.add("casino-trigger");
  logoEl.title = "🎰 жми, если фартовый";
  logoEl.addEventListener("click", () => {
    if (!document.body.classList.contains("design-v2")) return; // только новый дизайн
    casinoOn ? stopCasino() : startCasino();
  });
  buildEqualizer();
}

// ── Включение / выключение ─────────────────────────────────────────────────────
function startCasino() {
  casinoOn = true;
  document.body.classList.add("casino-mode");
  if (logoEl) logoEl.src = CASINO_LOGO;
  startMusic();          // музыка сразу, пока высвечивается «КАЗИНО»
  showIntroSplash();
  ensureAnalyser();
  startEqualizer();
  startCoins();
  coinBurst(90);
}

// Огромная разноцветная надпись «КАЗИНО» дугой: появляется → растёт → уходит.
function showIntroSplash() {
  document.querySelector(".casino-intro")?.remove();
  const word = "CASINO";
  const colors = ["#ff2e63", "#ff9a00", "#ffe600", "#27ff64", "#00d4ff", "#b14bff"];
  const c = (word.length - 1) / 2;
  // дуга балансируется вокруг центра (середина вверх, края вниз), чтобы надпись
  // визуально стояла ровно по центру окна, а не уезжала вниз
  const meanD2 = [...word].reduce((s, _, i) => s + (i - c) * (i - c), 0) / word.length;
  const letters = [...word].map((ch, i) => {
    const d = i - c, col = colors[i % colors.length];
    return `<span style="color:${col};--d:${d};--off:${(d * d - meanD2).toFixed(3)};text-shadow:0 0 26px ${col},0 0 50px ${col}">${ch}</span>`;
  }).join("");
  const el = document.createElement("div");
  el.className = "casino-intro";
  el.innerHTML = `<div class="casino-intro-word">${letters}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2100);
}

function stopCasino() {
  casinoOn = false;
  document.body.classList.remove("casino-mode");
  if (logoEl) logoEl.src = ORIG_LOGO;
  stopMusic();
  stopEqualizer();
  stopCoins();
  closeSlot();
}

// ── Музыка ──────────────────────────────────────────────────────────────────────
function startMusic() {
  if (!audioEl) {
    audioEl = new Audio(MUSIC_SRC);
    audioEl.loop = true;
    audioEl.volume = 0.55;
  }
  try { audioEl.currentTime = 0; } catch { /* not ready */ }
  audioEl.play().catch(() => { /* autoplay may need another gesture */ });
}
function stopMusic() {
  if (audioEl) { audioEl.pause(); }
}

// ── Звуковые эффекты (синтез через WebAudio, без файлов) ──────────────────────────
let audioCtx = null;
function ac() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}
function blip(freq, at, dur, type = "square", gain = 0.12) {
  const ctx = ac(); if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}
// Тиканье барабана: щелчки, которые редеют к концу (барабан замедляется).
function playSpinSound(totalMs) {
  const ctx = ac(); if (!ctx) return;
  const start = ctx.currentTime;
  const end = totalMs / 1000;
  blip(140, start, 0.08, "sawtooth", 0.18); // «дёрнул рычаг»
  let t = 0.05;
  while (t < end) {
    blip(820 + Math.random() * 160, start + t, 0.028, "square", 0.07);
    const p = t / end;
    t += 0.045 + p * p * 0.24; // ease-out: интервал между щелчками растёт
  }
}
// Выигрыш: низкий «бум» + бодрое арпеджио (для джекпота — повыше и погромче).
function playWinSound(big = false) {
  const ctx = ac(); if (!ctx) return;
  const t = ctx.currentTime;
  const boom = ctx.createOscillator();
  const bg = ctx.createGain();
  boom.type = "sine";
  boom.frequency.setValueAtTime(190, t);
  boom.frequency.exponentialRampToValueAtTime(55, t + 0.28);
  bg.gain.setValueAtTime(0.0001, t);
  bg.gain.linearRampToValueAtTime(0.32, t + 0.01);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  boom.connect(bg).connect(ctx.destination);
  boom.start(t); boom.stop(t + 0.45);
  const notes = big ? [659.25, 830.6, 987.77, 1318.5, 1661.2] : [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => blip(f, t + 0.04 + i * 0.07, 0.2, "triangle", 0.16));
}

// ── Эквалайзер в шапке (показывает «движуху» музыки) ─────────────────────────────
let mediaSource = null, analyser = null, eqCanvas = null, eqRAF = null, eqPhase = 0;
function buildEqualizer() {
  const header  = document.querySelector("#view-main .main-header");
  const actions = header?.querySelector(".main-header__actions");
  if (!header || !actions) return;
  const wrap = document.createElement("div");
  wrap.className = "casino-eq";
  wrap.innerHTML = `<div class="casino-eq-label">CASINO</div>`;
  eqCanvas = document.createElement("canvas");
  wrap.appendChild(eqCanvas);
  header.insertBefore(wrap, actions);
}
function ensureAnalyser() {
  const ctx = ac();
  if (!ctx || !audioEl || mediaSource) return; // источник создаётся один раз на элемент
  try {
    mediaSource = ctx.createMediaElementSource(audioEl);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    mediaSource.connect(analyser);
    analyser.connect(ctx.destination);
  } catch { analyser = null; } // не вышло — эквалайзер уйдёт в «фейковый» режим
}
function startEqualizer() {
  if (!eqCanvas || eqRAF) return;
  const cv = eqCanvas;
  cv.width  = cv.clientWidth  || 220;
  cv.height = cv.clientHeight || 40;
  const draw = () => {
    if (!casinoOn) return;
    eqRAF = requestAnimationFrame(draw);
    const g = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const N = 26;
    let data = null;
    if (analyser) { data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); }
    const bw = W / N;
    for (let i = 0; i < N; i++) {
      let v;
      if (data) v = data[Math.floor((i / N) * data.length)] / 255;
      else v = 0.25 + 0.55 * Math.abs(Math.sin(eqPhase * 0.07 + i * 0.55));
      const bh = Math.max(2, v * H);
      g.fillStyle = `hsl(${(i / N * 300 + eqPhase * 2) % 360}, 90%, 60%)`;
      g.fillRect(i * bw + 1, H - bh, bw - 2, bh);
    }
    eqPhase++;
  };
  draw();
}
function stopEqualizer() {
  if (eqRAF) { cancelAnimationFrame(eqRAF); eqRAF = null; }
  if (eqCanvas) { const g = eqCanvas.getContext("2d"); g && g.clearRect(0, 0, eqCanvas.width, eqCanvas.height); }
}

// ── Монеты со всех сторон (бока + верхние углы) ───────────────────────────────────
// На телефонах ливень монет лагает — там его полностью отключаем (всё остальное
// остаётся: радуга, музыка, слот, заставка).
function coinsDisabled() {
  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 820;
}
function rnd(a, b) { return a + Math.random() * (b - a); }
function spawnCoin(origin) {
  if (document.querySelectorAll(".casino-coin").length > COIN_CAP) return;
  const w = window.innerWidth, h = window.innerHeight;
  const coin = document.createElement("div");
  coin.className = "casino-coin";
  coin.textContent = COIN_GLYPHS[Math.floor(Math.random() * COIN_GLYPHS.length)];
  coin.style.fontSize = rnd(18, 42) + "px";
  const rot = (Math.random() < 0.5 ? -1 : 1) * rnd(360, 1000);

  let x0, y0, frames;
  if (origin === "left" || origin === "right") {
    const dir = origin === "left" ? 1 : -1;
    x0 = origin === "left" ? -30 : w + 30;
    y0 = rnd(h * 0.2, h * 0.92);
    const dx = dir * rnd(170, w * 0.55);
    const up = -rnd(150, 360);
    const fall = rnd(h * 0.3, h * 0.7);
    frames = [
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${up}px) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.4 },
      { transform: `translate(${dx}px, ${fall}px) rotate(${rot}deg)`, opacity: 0.85 },
    ];
  } else { // tl / tr — сыплются из верхних углов вниз
    const dir = origin === "tl" ? 1 : -1;
    x0 = origin === "tl" ? rnd(-10, w * 0.14) : rnd(w * 0.86, w + 10);
    y0 = rnd(-70, -10);
    const dx = dir * rnd(40, w * 0.5);
    const fall = h + rnd(40, 180);
    frames = [
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx}px, ${fall}px) rotate(${rot}deg)`, opacity: 0.9 },
    ];
  }
  coin.style.left = x0 + "px";
  coin.style.top  = y0 + "px";
  document.body.appendChild(coin);
  coin.animate(frames, { duration: rnd(1700, 3100), easing: "cubic-bezier(.25,.6,.4,1)" })
    .onfinish = () => coin.remove();
}

function startCoins() {
  if (coinTimer || coinsDisabled()) return;
  // золото рекой: бока (по 2 с каждой стороны) + оба верхних угла, каждые ~170мс
  coinTimer = setInterval(() => {
    spawnCoin("left"); spawnCoin("left");
    spawnCoin("right"); spawnCoin("right");
    spawnCoin("tl"); spawnCoin("tr");
  }, 170);
}
function pauseCoins() {
  if (coinTimer) { clearInterval(coinTimer); coinTimer = null; } // долетают уже заспавненные
}
function resumeCoins() {
  if (casinoOn && !coinTimer) startCoins();
}
function stopCoins() {
  pauseCoins();
  document.querySelectorAll(".casino-coin").forEach((c) => c.remove());
}
function coinBurst(n = 30) {
  if (coinsDisabled()) return;
  const origins = ["left", "right", "tl", "tr"];
  for (let i = 0; i < n; i++) {
    setTimeout(() => spawnCoin(origins[i % origins.length]), i * 22);
  }
}

// ── Слот-машина: счёт (2 барабана) + случайный игрок ──────────────────────────────
// Возвращает Promise<{home, away, player} | null>. null = «не ставить» (отказ).
export function runScoreSlot(playerPool) {
  return new Promise((resolve) => {
    const home = Math.floor(Math.random() * REEL_DIGITS);
    const away = Math.floor(Math.random() * REEL_DIGITS);
    const pool = (Array.isArray(playerPool) ? playerPool : []).filter(Boolean);
    const player = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    openSlot(home, away, player, pool, resolve);
  });
}

function buildStripHtml() {
  let html = "";
  for (let c = 0; c < REEL_CYCLES; c++) {
    for (let d = 0; d < REEL_DIGITS; d++) html += `<div class="casino-reel-digit">${d}</div>`;
  }
  return html;
}

function spinReel(strip, target, dur, onDone) {
  const cell = strip.querySelector(".casino-reel-digit");
  const H = cell ? cell.offsetHeight : 110;
  const landIndex = (REEL_CYCLES - 2) * REEL_DIGITS + target;
  strip.style.transition = "none";
  strip.style.transform  = "translateY(0)";
  void strip.offsetHeight; // reflow
  requestAnimationFrame(() => {
    strip.style.transition = `transform ${dur}ms cubic-bezier(.12,.8,.24,1)`;
    strip.style.transform  = `translateY(${-(landIndex * H)}px)`;
  });
  setTimeout(onDone, dur + 70);
}

let playerScrambleTimer = null;
function stopPlayerScramble() {
  if (playerScrambleTimer) { clearInterval(playerScrambleTimer); playerScrambleTimer = null; }
}

function openSlot(home, away, player, pool, resolve) {
  closeSlot();
  pauseCoins(); // спотлайт на слоте

  const overlay = document.createElement("div");
  overlay.className = "casino-slot-overlay";
  overlay.innerHTML = `
    <div class="casino-slot-backdrop"></div>
    <div class="casino-slot-machine">
      <div class="casino-slot-title">🎰 НАУГАД БЛЯ 🎰</div>
      <div class="casino-slot-reels">
        <div class="casino-reel"><div class="casino-reel-strip" data-reel="home">${buildStripHtml()}</div></div>
        <div class="casino-slot-colon">:</div>
        <div class="casino-reel"><div class="casino-reel-strip" data-reel="away">${buildStripHtml()}</div></div>
      </div>
      <div class="casino-player-roll">🎯 <span class="casino-player-name">…</span></div>
      <div class="casino-slot-result">🎲 крути, фартовый…</div>
      <div class="casino-slot-actions hidden">
        <button type="button" class="casino-slot-go">✅ Ставлю!</button>
        <button type="button" class="casino-slot-no">❌ Не ставить</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("casino-slot-overlay--in"));

  const homeStrip = overlay.querySelector('[data-reel="home"]');
  const awayStrip = overlay.querySelector('[data-reel="away"]');
  const nameEl    = overlay.querySelector(".casino-player-name");
  const result    = overlay.querySelector(".casino-slot-result");
  const actions   = overlay.querySelector(".casino-slot-actions");
  const goBtn      = overlay.querySelector(".casino-slot-go");
  const noBtn      = overlay.querySelector(".casino-slot-no");

  // игрок «скремблится» (быстро мелькает) пока крутятся барабаны
  if (pool.length) {
    playerScrambleTimer = setInterval(() => {
      nameEl.textContent = pool[Math.floor(Math.random() * pool.length)].name || "…";
    }, 70);
  } else {
    nameEl.textContent = "—";
  }

  let landed = 0;
  const onLand = () => {
    if (++landed < 2) return;
    stopPlayerScramble();
    nameEl.textContent = player ? player.name : "—";
    const jackpot = home === away;
    result.innerHTML = jackpot ? `🎉 ДЖЕКПОТ! ${home}:${away} 🎉` : `Выпало: <b>${home}:${away}</b>`;
    result.classList.toggle("casino-slot-result--jackpot", jackpot);
    goBtn.textContent = `✅ Ставлю ${home}:${away}`;
    actions.classList.remove("hidden");
    playWinSound(jackpot);
    coinBurst(jackpot ? 60 : 24);
  };

  playSpinSound(3600);
  spinReel(homeStrip, home, 2600, onLand);
  spinReel(awayStrip, away, 3600, onLand);

  let settled = false;
  const finish = (accepted) => {
    if (settled) return;
    settled = true;
    stopPlayerScramble();
    closeSlot();
    resumeCoins();
    if (accepted) coinBurst(26);
    resolve(accepted ? { home: String(home), away: String(away), player: player ? player.name : null } : null);
  };
  goBtn.addEventListener("click", () => finish(true));
  noBtn.addEventListener("click", () => finish(false));
  // клик по фону = отказ, но только после остановки барабанов
  overlay.querySelector(".casino-slot-backdrop").addEventListener("click", () => {
    if (landed >= 2) finish(false);
  });
}

function closeSlot() {
  stopPlayerScramble();
  document.querySelector(".casino-slot-overlay")?.remove();
}
