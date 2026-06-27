import { WC_TEAMS } from "./store.js";

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Team Selector ────────────────────────────────────────────────────────────
// 48 WC 2026 teams, searchable chip list. Returns () => string.
export function createTeamSelector(container, onChange, currentVal = "", disabled = false) {
  let selected = currentVal || "";
  let query    = "";

  function render() {
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "wcs-wrap";

    if (selected) {
      // ── chip mode ──
      const chip = document.createElement("div");
      chip.className = "wcs-selected";
      if (!disabled) chip.title = "Нажми, чтобы изменить";

      const txt = document.createElement("span");
      txt.className = "wcs-selected-text";
      txt.textContent = selected;
      chip.appendChild(txt);

      if (!disabled) {
        const clr = document.createElement("button");
        clr.type = "button";
        clr.className = "wcs-clear";
        clr.textContent = "×";
        clr.addEventListener("click", (e) => {
          e.stopPropagation();
          selected = ""; query = "";
          render(); onChange("");
          setTimeout(() => container.querySelector(".wcs-input")?.focus(), 0);
        });
        chip.appendChild(clr);

        chip.addEventListener("click", () => {
          query = selected; selected = "";
          render();
          setTimeout(() => {
            const inp = container.querySelector(".wcs-input");
            if (inp) { inp.focus(); inp.select(); }
          }, 0);
        });
      }

      wrap.appendChild(chip);
    } else {
      // ── search mode ──
      const inputWrap = document.createElement("div");
      inputWrap.className = "wcs-input-wrap";

      const input = document.createElement("input");
      input.type        = "text";
      input.className   = "wcs-input";
      input.placeholder = "Поиск по 48 командам ЧМ...";
      input.value       = query;
      if (disabled) input.disabled = true;

      inputWrap.appendChild(input);
      wrap.appendChild(inputWrap);

      const dd = document.createElement("div");
      dd.className = "wcs-dropdown";

      function buildDropdown() {
        dd.innerHTML = "";
        const q     = query.trim().toLowerCase();
        const teams = q
          ? WC_TEAMS.filter((t) => t.toLowerCase().includes(q))
          : WC_TEAMS;

        if (teams.length === 0) {
          dd.innerHTML = `<p class="wcs-empty">Ничего не найдено</p>`;
        } else {
          teams.forEach((t) => {
            const btn = document.createElement("button");
            btn.type      = "button";
            btn.className = "wcs-option";
            btn.textContent = t;
            btn.addEventListener("mousedown", (e) => {
              e.preventDefault();
              selected = t; query = "";
              render(); onChange(selected);
            });
            dd.appendChild(btn);
          });
        }
      }

      if (!disabled) {
        input.addEventListener("focus", () => {
          buildDropdown();
          if (!wrap.contains(dd)) wrap.appendChild(dd);
        });

        input.addEventListener("input", (e) => {
          query = e.target.value;
          buildDropdown();
          if (!wrap.contains(dd)) wrap.appendChild(dd);
        });

        input.addEventListener("blur", () => {
          setTimeout(() => dd.remove(), 200);
        });
      }
    }

    container.appendChild(wrap);
  }

  render();
  return () => selected;
}


// ─── Player Selector ──────────────────────────────────────────────────────────
// Type-ahead search via /api/wc/search-players. Returns () => string.
export function createPlayerSelector(container, onChange, currentVal = "", disabled = false) {
  let selected    = currentVal || "";
  let query       = "";
  let results     = [];
  let loading     = false;
  let searchTimer = null;
  let reqVersion  = 0;  // guards stale async responses

  function render() {
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "wcs-wrap";

    if (selected) {
      // ── chip mode ──
      const chip = document.createElement("div");
      chip.className = "wcs-selected";
      if (!disabled) chip.title = "Нажми, чтобы изменить";

      const txt = document.createElement("span");
      txt.className = "wcs-selected-text";
      txt.textContent = selected;
      chip.appendChild(txt);

      if (!disabled) {
        const clr = document.createElement("button");
        clr.type = "button";
        clr.className = "wcs-clear";
        clr.textContent = "×";
        clr.addEventListener("click", (e) => {
          e.stopPropagation();
          selected = ""; query = ""; results = [];
          render(); onChange("");
          setTimeout(() => container.querySelector(".wcs-input")?.focus(), 0);
        });
        chip.appendChild(clr);

        chip.addEventListener("click", () => {
          query = selected; selected = ""; results = [];
          render();
          setTimeout(() => {
            const inp = container.querySelector(".wcs-input");
            if (inp) {
              inp.focus(); inp.select();
              inp.dispatchEvent(new Event("input"));
            }
          }, 0);
        });
      }

      wrap.appendChild(chip);
    } else {
      // ── search mode ──
      const inputWrap = document.createElement("div");
      inputWrap.className = "wcs-input-wrap";

      const input = document.createElement("input");
      input.type        = "text";
      input.className   = "wcs-input";
      input.placeholder = "Начни вводить фамилию игрока...";
      input.value       = query;
      if (disabled) input.disabled = true;

      inputWrap.appendChild(input);
      wrap.appendChild(inputWrap);

      let dd = null;

      function showDropdown() {
        if (!dd) {
          dd = document.createElement("div");
          dd.className = "wcs-dropdown";
          wrap.appendChild(dd);
        }
        refreshDropdown();
      }

      function hideDropdown() {
        dd?.remove();
        dd = null;
      }

      function refreshDropdown() {
        if (!dd) return;
        dd.innerHTML = "";

        if (loading) {
          dd.innerHTML = `<p class="wcs-loading">Ищу...</p>`;
          return;
        }

        if (results.length > 0) {
          results.forEach((p) => {
            const btn = document.createElement("button");
            btn.type      = "button";
            btn.className = "wcs-option wcs-option--player";
            const team = p.nationality || p.team || "";
            btn.innerHTML = `<span class="wcs-player-name">${esc(p.name)}</span>${team ? `<span class="wcs-player-team">${esc(team)}</span>` : ""}`;
            btn.addEventListener("mousedown", (e) => {
              e.preventDefault();
              selected = p.name; query = ""; results = [];
              render(); onChange(selected);
            });
            dd.appendChild(btn);
          });
        } else if (query.length >= 2) {
          dd.innerHTML = `<p class="wcs-empty">Ничего не найдено</p>`;
        }

        // Always show "use typed" option when something is entered
        if (query.trim().length >= 2) {
          const useBtn = document.createElement("button");
          useBtn.type      = "button";
          useBtn.className = "wcs-use-typed";
          useBtn.textContent = `Ввести «${query.trim()}»`;
          useBtn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            selected = query.trim(); query = ""; results = [];
            render(); onChange(selected);
          });
          dd.appendChild(useBtn);
        }
      }

      async function doSearch(q, v) {
        try {
          const res = await fetch(`/api/wc/search-players?q=${encodeURIComponent(q)}`);
          if (reqVersion !== v) return;
          results = res.ok ? await res.json() : [];
        } catch {
          if (reqVersion !== v) return;
          results = [];
        }
        loading = false;
        refreshDropdown();
      }

      if (!disabled) {
        input.addEventListener("input", (e) => {
          query = e.target.value;
          clearTimeout(searchTimer);

          if (query.trim().length >= 2) {
            results = []; loading = true;
            showDropdown();
            const v = ++reqVersion;
            searchTimer = setTimeout(() => doSearch(query.trim(), v), 380);
          } else {
            results = []; loading = false;
            hideDropdown();
          }
        });

        input.addEventListener("focus", () => {
          if (query.trim().length >= 2 && (results.length > 0 || loading)) showDropdown();
        });

        input.addEventListener("blur", () => {
          setTimeout(() => hideDropdown(), 200);
        });

        // If re-rendered with pre-existing query (edit flow), trigger search
        if (query.trim().length >= 2) {
          results = []; loading = true;
          showDropdown();
          const v = ++reqVersion;
          setTimeout(() => doSearch(query.trim(), v), 0);
        }
      }
    }

    container.appendChild(wrap);
  }

  render();
  return () => selected;
}
