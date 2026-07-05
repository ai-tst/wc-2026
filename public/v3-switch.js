// OTS-82: переключатель на новый дизайн v3. Показывается ТОЛЬКО аккаунту Тимы
// (timofeytst). Для всех остальных не рендерит ничего — старый дизайн не меняется.
// Чисто аддитивно и в try/catch: если что-то падает, старый сайт работает как есть.
(async () => {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) return;
    const me = await res.json();
    if (!me || (me.nickname || "").toLowerCase() !== "timofeytst") return;

    const fab = document.createElement("a");
    fab.href = "/v3";
    fab.setAttribute("aria-label", "Переключиться на новый дизайн v3");
    fab.title = "Новый дизайн v3 — только у тебя";
    fab.textContent = "✨ Новый дизайн";
    Object.assign(fab.style, {
      position: "fixed", right: "16px", bottom: "calc(16px + env(safe-area-inset-bottom,0px))",
      zIndex: "9999", display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "11px 16px", borderRadius: "999px", textDecoration: "none",
      fontFamily: "'Inter',system-ui,sans-serif", fontWeight: "700", fontSize: "13.5px",
      letterSpacing: "-.01em", color: "#04160c", background: "#2ee27a",
      boxShadow: "0 8px 26px rgba(46,226,122,.4)", transition: "transform .18s ease",
    });
    fab.addEventListener("mousedown", () => (fab.style.transform = "scale(.95)"));
    fab.addEventListener("mouseup", () => (fab.style.transform = "none"));
    fab.addEventListener("mouseleave", () => (fab.style.transform = "none"));
    document.body.appendChild(fab);
  } catch { /* старый дизайн не должен страдать из-за этого */ }
})();
