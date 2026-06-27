// ── Шеринг прогноза картинкой ────────────────────────────────────────────────
// Генерит вайбовую виральную картинку результата матча (твой прогноз vs реал,
// вердикт ЗАШЛО/СЛИЛ, очки, вайб-слово, лого + ссылка на сайт) прямо в браузере
// через canvas — без сервера и без билд-степа. Открывает оверлей с превью и
// кнопками: Поделиться (нативный share с файлом), Скачать, В Telegram, Копировать.
//
// Картинка = маркетинговый инструмент: на ней крупно лого «Отсос» и адрес сайта,
// чтобы расшаренная карточка приводила новых чуваков с эффектом «ВАУ».

const SITE_URL = "https://51.250.35.235.sslip.io";
const SITE_LABEL = "51.250.35.235.sslip.io";
const FLAG_CDN = (code) => `https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/${code}.svg`;
const LOGO_SRC = "otsos-logo.png";

// Логический размер карточки (4:5 — лёг и в сторис, и в чат).
const W = 1080;
const H = 1350;
const PAD = 72;

// Токены дизайн-системы (синхронизировано с :root в styles.css).
const C = {
  bg: "#050816",
  bgSoft: "#0f172a",
  blue: "29, 78, 216", // #1d4ed8
  accent: "#22c55e",
  accentStrong: "#16a34a",
  accentRGB: "34, 197, 94",
  text: "#e5e7eb",
  muted: "#9ca3af",
  border: "#1f2937",
  danger: "#ef4444",
  dangerRGB: "239, 68, 68",
  gold: "#fbbf24",
};

// ── загрузка ассетов (лого + флаги) с таймаутом, без падений ──────────────────
function loadImg(src, { cors = false } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    setTimeout(() => finish(null), 4000);
    img.src = src;
  });
}

async function ensureFont() {
  // Russo One — дисплейный шрифт бренда. Дождёмся, иначе canvas нарисует system-ui.
  try {
    if (document.fonts?.load) {
      await Promise.all([
        document.fonts.load('700 120px "Russo One"'),
        document.fonts.load('400 48px "Russo One"'),
      ]);
      await document.fonts.ready;
    }
  } catch { /* не критично — упадём на системный шрифт */ }
}

// ── canvas-хелперы ────────────────────────────────────────────────────────────
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fitFontSize(ctx, text, family, weight, maxWidth, startPx, minPx = 24) {
  let px = startPx;
  for (; px > minPx; px -= 2) {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  ctx.font = `${weight} ${px}px ${family}`;
  return px;
}

const DISPLAY = '"Russo One", system-ui, sans-serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function drawFlag(ctx, img, cx, y, h) {
  // флаг 4:3, скруглённый, с тонкой рамкой; центрируется по cx
  const w = (h * 4) / 3;
  const x = cx - w / 2;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 10);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    ctx.fillStyle = C.bgSoft;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 10);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.stroke();
  ctx.restore();
  return w;
}

// ── основная отрисовка карточки ───────────────────────────────────────────────
async function renderCard(data) {
  const [logo, homeFlag, awayFlag] = await Promise.all([
    loadImg(LOGO_SRC),
    data.homeCode ? loadImg(FLAG_CDN(data.homeCode), { cors: true }) : Promise.resolve(null),
    data.awayCode ? loadImg(FLAG_CDN(data.awayCode), { cors: true }) : Promise.resolve(null),
  ]);
  await ensureFont();

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // фон + неоновые радиальные подсветки (как у боди в дизайн-системе)
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const gTop = ctx.createRadialGradient(W * 0.18, H * 0.1, 0, W * 0.18, H * 0.1, W * 1.05);
  gTop.addColorStop(0, `rgba(${C.blue}, 0.5)`);
  gTop.addColorStop(1, `rgba(${C.blue}, 0)`);
  ctx.fillStyle = gTop;
  ctx.fillRect(0, 0, W, H);
  const win = data.pts > 0;
  const glowRGB = win ? C.accentRGB : C.dangerRGB;
  const gBot = ctx.createRadialGradient(W * 0.85, H * 0.92, 0, W * 0.85, H * 0.92, W * 0.95);
  gBot.addColorStop(0, `rgba(${glowRGB}, 0.28)`);
  gBot.addColorStop(1, `rgba(${glowRGB}, 0)`);
  ctx.fillStyle = gBot;
  ctx.fillRect(0, 0, W, H);

  // внутренняя рамка
  ctx.save();
  roundRectPath(ctx, 20, 20, W - 40, H - 40, 28);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(148,163,184,0.18)";
  ctx.stroke();
  ctx.restore();

  // ── шапка: лого + бренд + ЧМ-2026 ──
  let headY = PAD;
  const logoSize = 88;
  if (logo) {
    ctx.save();
    roundRectPath(ctx, PAD, headY, logoSize, logoSize, 18);
    ctx.clip();
    ctx.drawImage(logo, PAD, headY, logoSize, logoSize);
    ctx.restore();
  }
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `700 52px ${DISPLAY}`;
  ctx.fillStyle = C.text;
  ctx.fillText("ОТСОС", PAD + logoSize + 22, headY + logoSize / 2 - 14);
  ctx.font = `400 24px ${SANS}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("ставки на ЧМ-2026", PAD + logoSize + 24, headY + logoSize / 2 + 22);

  ctx.textAlign = "right";
  ctx.font = `700 30px ${DISPLAY}`;
  ctx.fillStyle = C.accent;
  ctx.fillText("2026", W - PAD, headY + logoSize / 2 - 12);
  ctx.font = `400 20px ${SANS}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("WORLD CUP", W - PAD, headY + logoSize / 2 + 18);

  // ── стадия/лига ──
  let y = headY + logoSize + 56;
  if (data.typeLine) {
    ctx.textAlign = "center";
    fitFontSize(ctx, data.typeLine.toUpperCase(), SANS, "600", W - PAD * 2, 26, 18);
    ctx.fillStyle = C.muted;
    ctx.fillText(data.typeLine.toUpperCase(), W / 2, y);
  }

  // ── матч: флаг+страна, огромный счёт, флаг+страна ──
  y += 84;
  const flagH = 72;
  // home
  drawFlag(ctx, homeFlag, W / 2, y - flagH / 2, flagH);
  y += flagH / 2 + 44;
  ctx.textAlign = "center";
  ctx.fillStyle = C.text;
  fitFontSize(ctx, data.home.toUpperCase(), DISPLAY, "700", W - PAD * 2, 58, 30);
  ctx.fillText(data.home.toUpperCase(), W / 2, y);

  // счёт
  y += 150;
  ctx.font = `700 150px ${DISPLAY}`;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = `rgba(${glowRGB}, 0.55)`;
  ctx.shadowBlur = 38;
  ctx.fillText(`${data.homeScore} : ${data.awayScore}`, W / 2, y);
  ctx.shadowBlur = 0;

  // away
  y += 130;
  ctx.fillStyle = C.text;
  fitFontSize(ctx, data.away.toUpperCase(), DISPLAY, "700", W - PAD * 2, 58, 30);
  ctx.fillText(data.away.toUpperCase(), W / 2, y);
  y += 36;
  drawFlag(ctx, awayFlag, W / 2, y, flagH);
  y += flagH + 70;

  // ── вердикт-штамп (главный виральный крючок) ──
  const verdict = data.verdict; // { label, tone: 'win'|'exact'|'lose' }
  const stampColor = verdict.tone === "lose" ? C.danger : C.accent;
  const stampRGB = verdict.tone === "lose" ? C.dangerRGB : C.accentRGB;
  ctx.save();
  ctx.translate(W / 2, y);
  ctx.rotate((-6 * Math.PI) / 180);
  const stampPx = fitFontSize(ctx, verdict.label, DISPLAY, "700", W - PAD * 2 - 80, 84, 44);
  const stampW = ctx.measureText(verdict.label).width + 80;
  const stampH = stampPx + 44;
  roundRectPath(ctx, -stampW / 2, -stampH / 2, stampW, stampH, 22);
  ctx.fillStyle = `rgba(${stampRGB}, 0.14)`;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = stampColor;
  ctx.stroke();
  ctx.fillStyle = stampColor;
  ctx.textBaseline = "middle";
  ctx.shadowColor = `rgba(${stampRGB}, 0.5)`;
  ctx.shadowBlur = 24;
  ctx.fillText(verdict.label, 0, 4);
  ctx.shadowBlur = 0;
  ctx.restore();
  y += stampH / 2 + 70;

  // ── твой прогноз + очки + вайб ──
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `400 30px ${SANS}`;
  ctx.fillStyle = C.muted;
  const predTxt = `твой прогноз: ${data.predScore}`;
  ctx.fillText(predTxt, W / 2, y);
  y += 78;

  // очки + вайб-слово
  ctx.font = `700 64px ${DISPLAY}`;
  ctx.fillStyle = win ? C.accent : C.muted;
  const ptsTxt = `${win ? "+" : ""}${data.pts} PTS`;
  const vibe = (data.vibe || "").toUpperCase();
  ctx.font = `400 34px ${SANS}`;
  const vibeW = vibe ? ctx.measureText(`  •  ${vibe}`).width : 0;
  ctx.font = `700 64px ${DISPLAY}`;
  const ptsW = ctx.measureText(ptsTxt).width;
  const totalW = ptsW + vibeW;
  let lineX = W / 2 - totalW / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = win ? C.accent : C.muted;
  ctx.fillText(ptsTxt, lineX, y);
  if (vibe) {
    ctx.font = `400 34px ${SANS}`;
    ctx.fillStyle = win ? C.gold : C.danger;
    ctx.fillText(`  •  ${vibe}`, lineX + ptsW, y - 6);
  }
  y += 60;

  // ник
  ctx.textAlign = "center";
  ctx.font = `600 30px ${SANS}`;
  ctx.fillStyle = C.text;
  ctx.fillText(data.nick, W / 2, y);

  // ── футер-CTA: ссылка + призыв (крючок для новых юзеров) ──
  const barH = 116;
  const barY = H - PAD - barH;
  ctx.save();
  roundRectPath(ctx, PAD, barY, W - PAD * 2, barH, 22);
  const gBar = ctx.createLinearGradient(PAD, barY, W - PAD, barY + barH);
  gBar.addColorStop(0, C.accent);
  gBar.addColorStop(1, C.accentStrong);
  ctx.fillStyle = gBar;
  ctx.shadowColor = `rgba(${C.accentRGB}, 0.45)`;
  ctx.shadowBlur = 34;
  ctx.fill();
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillStyle = "#022c22";
  ctx.font = `700 40px ${DISPLAY}`;
  ctx.fillText(SITE_LABEL, W / 2, barY + 52);
  ctx.font = `700 26px ${SANS}`;
  ctx.fillText("ЗАЛЕТАЙ И ДЕЛАЙ СТАВКУ 🔥", W / 2, barY + 92);

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob((b) => resolve(b), "image/png");
    else resolve(null);
  });
}

// ── мелкий тост ───────────────────────────────────────────────────────────────
function toast(msg, ok = true) {
  document.querySelector(".share-toast")?.remove();
  const el = document.createElement("div");
  el.className = "share-toast" + (ok ? "" : " share-toast--bad");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ── оверлей с превью и действиями ────────────────────────────────────────────
function buildOverlay(canvas, blob, data) {
  const url = URL.createObjectURL(blob);
  const fileName = `otsos-prognoz-${(data.home + "-" + data.away).toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-")}.png`;
  const file = blob ? new File([blob], fileName, { type: "image/png" }) : null;

  const shareText = `${data.verdict.label}! Мой прогноз на ${data.home} — ${data.away} (${data.homeScore}:${data.awayScore}). Залетай на Отсос 👉`;
  const canShareFiles = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));

  const overlay = document.createElement("div");
  overlay.className = "share-overlay";
  overlay.innerHTML = `
    <div class="share-modal" role="dialog" aria-label="Поделиться прогнозом">
      <button class="share-close" aria-label="Закрыть">✕</button>
      <div class="share-modal__title">Твоя карточка 🔥</div>
      <img class="share-preview" alt="Превью карточки прогноза" src="${url}" />
      <div class="share-actions">
        ${canShareFiles ? `<button class="share-act share-act--primary" data-act="share">📲 Поделиться</button>` : ""}
        <button class="share-act" data-act="download">📥 Скачать</button>
        <button class="share-act" data-act="telegram">✈️ В Telegram</button>
        <button class="share-act" data-act="copy">📋 Копировать</button>
      </div>
      <div class="share-modal__hint muted small">Кинь в чат или в сторис — пусть кореша завидуют 😎</div>
    </div>`;

  const close = () => {
    overlay.remove();
    URL.revokeObjectURL(url);
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".share-close").addEventListener("click", close);

  overlay.querySelector(".share-actions").addEventListener("click", async (e) => {
    const btn = e.target.closest(".share-act");
    if (!btn) return;
    const act = btn.dataset.act;
    try {
      if (act === "share" && file) {
        await navigator.share({ files: [file], text: shareText });
      } else if (act === "download") {
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast("Скачано 📥");
      } else if (act === "telegram") {
        const tg = `https://t.me/share/url?url=${encodeURIComponent(SITE_URL)}&text=${encodeURIComponent(shareText)}`;
        window.open(tg, "_blank", "noopener");
        if (!canShareFiles) toast("Картинку прикрепи из «Скачать» 📥");
      } else if (act === "copy") {
        if (navigator.clipboard && window.ClipboardItem && blob) {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          toast("Картинка скопирована 📋");
        } else {
          toast("Копирование не поддержано — жми «Скачать»", false);
        }
      }
    } catch (err) {
      // отмена нативного share — не ошибка
      if (err && err.name !== "AbortError") toast("Не вышло, попробуй «Скачать»", false);
    }
  });

  document.body.appendChild(overlay);
}

// ── публичная точка входа ─────────────────────────────────────────────────────
// data: { home, away, homeCode, awayCode, homeScore, awayScore, predScore,
//         pts, verdict:{label,tone}, vibe, nick, typeLine }
export async function openShareCard(data, triggerBtn) {
  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.dataset.loading = "1"; }
  try {
    const canvas = await renderCard(data);
    const blob = await canvasToBlob(canvas);
    if (!blob) { toast("Не удалось собрать картинку", false); return; }
    buildOverlay(canvas, blob, data);
  } catch (err) {
    console.error("[share-card]", err);
    toast("Что-то пошло не так с картинкой", false);
  } finally {
    if (triggerBtn) { triggerBtn.disabled = false; delete triggerBtn.dataset.loading; }
  }
}
