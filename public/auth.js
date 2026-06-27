import { $, showError } from "./utils.js";
import { apiRegister, apiLogin, apiLogout } from "./api-client.js";

export function setupAuth(onRoute) {
  const tabs        = document.querySelectorAll(".auth-tab");
  const registerForm = $("register-form");
  const loginForm    = $("login-form");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const isRegister = tab.dataset.tab === "register";
      tabs.forEach((t) => t.classList.toggle("auth-tab--active", t === tab));
      registerForm.classList.toggle("hidden", !isRegister);
      loginForm.classList.toggle("hidden", isRegister);
      showError($("register-error"), "");
      showError($("login-error"), "");
    });
  });

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("register-error");
    const btn   = registerForm.querySelector("button[type=submit]");
    btn.disabled = true;

    try {
      await apiRegister({
        nickname:        $("reg-nickname").value.trim(),
        password:        $("reg-password").value,
        passwordConfirm: $("reg-password-confirm").value,
        fullName:        $("reg-fullname").value.trim(),
        passportNumber:  $("reg-passport-number").value.trim(),
        issuedBy:        $("reg-passport-issued").value.trim(),
        issueDate:       $("reg-passport-date").value,
      });
      registerForm.reset();
      showError(errEl, "");
      await onRoute();
    } catch (err) {
      showError(errEl, err.message);
    } finally {
      btn.disabled = false;
    }
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("login-error");
    const btn   = loginForm.querySelector("button[type=submit]");
    btn.disabled = true;

    try {
      await apiLogin(
        $("login-nickname").value.trim(),
        $("login-password").value,
      );
      loginForm.reset();
      showError(errEl, "");
      await onRoute();
    } catch (err) {
      showError(errEl, err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("logout-btn").addEventListener("click", async () => {
    await apiLogout().catch(() => {});
    await onRoute();
  });
}
