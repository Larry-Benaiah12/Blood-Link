import { post } from "../api.js";
import { saveSession, getRole, homeFor, setPendingEmail, takeFlash } from "../auth.js";
import { mountShell } from "../shell.js";
import { mountGoogle } from "../google.js";
import { h, field, showAlert, clearAlert, setLoading, validate } from "../ui.js";

if (getRole()) location.replace(homeFor());
mountShell();

const alertEl = document.getElementById("alert");
const flash = takeFlash();
if (flash) showAlert(alertEl, flash, "success");
const SLOW_HINT = "Waking up the server — the first request can take up to a minute. Thanks for waiting…";

const form = h(
  "form",
  { class: "card", novalidate: true },
  h("h2", {}, "Welcome back"),
  h("p", { class: "muted" }, "Log in with your donor, hospital or admin account."),
  field({ label: "Email", name: "email", type: "email", autocomplete: "username" }),
  field({ label: "Password", name: "password", type: "password", autocomplete: "current-password" }),
  h("p", { style: "margin:-4px 0 14px;text-align:right" }, h("a", { href: "forgot-password.html" }, "Forgot password?")),
  h("button", { type: "submit", class: "btn btn-primary btn-block lp-btn-lg" }, "Log in")
);
const app = document.getElementById("app");
app.append(
  form,
  h("p", { class: "auth-switch" }, "New here? ", h("a", { href: "register-donor.html" }, "Become a donor"), " or ", h("a", { href: "register-hospital.html" }, "register a hospital"))
);

mountGoogle({ container: form, alertEl });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAlert(alertEl);
  const ok = validate(form, {
    email: (v) => (!v ? "Please enter your email." : form.elements.email.checkValidity() ? "" : "That doesn't look like an email address."),
    password: (v) => (v ? "" : "Please enter your password."),
  });
  if (!ok) return;

  const submit = form.querySelector('[type="submit"]');
  setLoading(submit, true, "Logging in…");
  const slow = setTimeout(() => showAlert(alertEl, SLOW_HINT, "info"), 4000);
  try {
    const { access_token, user, role } = await post("/api/auth/login", {
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
    });
    saveSession(access_token, user);
    location.href = homeFor(role || user.role);
  } catch (err) {
    // Unverified account: go straight to the verify screen, which sends a fresh code.
    if (err.status === 403 && (err.code === "email_not_verified" || /verify your email/i.test(err.message))) {
      setPendingEmail(form.elements.email.value.trim().toLowerCase());
      location.href = "verify-email.html?resend=1";
      return;
    }
    setLoading(submit, false);
    showAlert(alertEl, err.message);
  } finally {
    clearTimeout(slow);
  }
});
