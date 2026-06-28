// ── Донат разрабу: заметная плавающая монетка + мини-модалка с реквизитами ────
// Вынесли донат из подвала наверх по заметности: sticky-кнопка-«монетка» в углу,
// дерзкий призыв, клик → реквизиты с копированием. Связка с казиком — монетка
// крутится на ховере/клике. В режиме казика прячемся (там свой коин-вайб).

// Реквизиты доната (тот же пункт назначения, что и в подвале — НЕ меняем)
const DONATE_PHONE_DISPLAY = "+7-977-265-31-55 ПСБ";
const DONATE_PHONE_COPY = "+79772653155";

// Короткие дерзкие подписи для кнопки (рандом при загрузке)
const FAB_LABELS = [
  "Закинь на энергос",
  "Задонать разрабу",
  "Спонсируй отсос",
  "Накорми кодера",
];

// Призывы для модалки (рандом при каждом открытии)
const PITCHES = [
  "Закинь разрабу на энергос 🥤",
  "Задонать создателю — ему на ролтон не хватает 🍜",
  "Без доната сервак ляжет 💀 закинь копейку",
  "Спонсируй мой отсос ❤️",
  "Одна монетка = разраб не голодает 🪙",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function toast(msg, ok = true) {
  document.querySelector(".share-toast")?.remove();
  const el = document.createElement("div");
  el.className = "share-toast" + (ok ? "" : " share-toast--bad");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function openModal() {
  if (document.querySelector(".donate-overlay")) return;

  const overlay = document.createElement("div");
  overlay.className = "share-overlay donate-overlay";
  overlay.innerHTML = `
    <div class="share-modal donate-modal" role="dialog" aria-label="Донат разработчику">
      <button class="share-close" type="button" aria-label="Закрыть">✕</button>
      <div class="donate-modal__coin" aria-hidden="true">🪙</div>
      <div class="share-modal__title">${pick(PITCHES)}</div>
      <p class="donate-modal__sub muted small">Перевод по номеру (СБП). Спасибо, ты топ 😎</p>
      <div class="donate-modal__req">
        <span class="donate-modal__phone">${DONATE_PHONE_DISPLAY}</span>
        <button class="share-act donate-modal__copy" type="button">📋 Скопировать номер</button>
      </div>
    </div>`;

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".share-close").addEventListener("click", close);
  document.addEventListener(
    "keydown",
    function onEsc(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", onEsc);
      }
    }
  );

  overlay.querySelector(".donate-modal__copy").addEventListener("click", async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(DONATE_PHONE_COPY);
        toast("Номер скопирован 📋");
      } else {
        toast("Скопируй вручную: " + DONATE_PHONE_DISPLAY, false);
      }
    } catch {
      toast("Скопируй вручную: " + DONATE_PHONE_DISPLAY, false);
    }
  });

  document.body.appendChild(overlay);
}

export function setupDonate() {
  const fab = document.getElementById("donate-fab");
  if (!fab) return;
  const labelEl = fab.querySelector(".donate-fab__label");
  if (labelEl) labelEl.textContent = pick(FAB_LABELS);
  fab.addEventListener("click", openModal);
}
