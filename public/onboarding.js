import { currentUser, setCurrentUser } from "./store.js";
import { $, showError } from "./utils.js";
import { apiSaveOutrights } from "./api-client.js";
import { createDarkHorseSelector } from "./outrights.js";
import { createTeamSelector, createPlayerSelector } from "./wc-selector.js";

let _onbDHGetter     = () => [];
let _onbWinnerGetter = () => "";
let _onbBPGetter     = () => "";
let _onbTSGetter     = () => "";

export function setupOnboarding(onRoute) {
  // Initialize all selectors when the onboarding section is available
  const dhContainer = $("onb-dark-horse-selector");
  if (dhContainer) _onbDHGetter = createDarkHorseSelector(dhContainer, () => {});

  const wc = $("onb-winner-selector");
  if (wc) _onbWinnerGetter = createTeamSelector(wc, () => {});

  const bpc = $("onb-bp-selector");
  if (bpc) _onbBPGetter = createPlayerSelector(bpc, () => {});

  const tsc = $("onb-ts-selector");
  if (tsc) _onbTSGetter = createPlayerSelector(tsc, () => {});

  $("onboarding-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("onboarding-error");
    if (!currentUser) return;

    const winner     = _onbWinnerGetter().trim();
    const bestPlayer = _onbBPGetter().trim();
    const topScorer  = _onbTSGetter().trim();
    const dhPicks    = _onbDHGetter();

    const outrights = {
      winner,
      bestPlayer,
      topScorer,
      darkHorse: JSON.stringify(dhPicks),
    };

    if (!winner || !bestPlayer || !topScorer) {
      showError(errEl, "Заполните все поля.");
      return;
    }
    if (dhPicks.length < 3) {
      showError(errEl, "Выбери ровно 3 уёбищные команды.");
      return;
    }

    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await apiSaveOutrights(outrights);
      currentUser.outrights = outrights;
      currentUser.onboardingComplete = true;
      showError(errEl, "");
      await onRoute();
    } catch (err) {
      showError(errEl, err.message || "Ошибка сохранения.");
    } finally {
      btn.disabled = false;
    }
  });
}
