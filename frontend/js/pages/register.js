// Shared by register-donor.js and register-hospital.js.

import { post } from "../api.js";
import { setPendingEmail } from "../auth.js";
import { h, showAlert, clearAlert, setLoading, validate } from "../ui.js";
import { PHONE_RE } from "../constants.js";

const SLOW_HINT = "Waking up the server — the first request can take up to a minute. Thanks for waiting…";

export const required = (msg) => (v) => (v ? "" : msg);
export const maxLen = (msg, n) => (v) => (v.length > n ? msg : "");
export const both = (...fns) => (v) => fns.map((f) => f(v)).find(Boolean) || "";

export const baseRules = {
  email: (v) => (!v ? "Please enter your email." : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "" : "That doesn't look like an email address."),
  password: (v) => (v.length >= 8 ? "" : "Use at least 8 characters."),
  phone: (v) => (PHONE_RE.test(v.replace(/\s+/g, "")) ? "" : "Use a Ghana number: 0XXXXXXXXX or +233XXXXXXXXX."),
};

/**
 * Mounts a registration form. Registers, then goes to the email
 * verification screen (the API returns no token until the email is verified).
 */
export function mountRegister({ title, intro, fields, rules, build, switchLink }) {
  const alertEl = document.getElementById("alert");
  const form = h(
    "form",
    { class: "card", novalidate: true },
    h("h2", {}, title),
    h("p", { class: "muted" }, intro),
    fields,
    h("button", { type: "submit", class: "btn btn-primary btn-block lp-btn-lg" }, "Create account")
  );
  document.getElementById("app").append(form, h("p", { class: "auth-switch" }, ...switchLink));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertEl);
    if (!validate(form, rules)) return;

    const payload = build(form.elements);
    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Creating account…");
    const slow = setTimeout(() => showAlert(alertEl, SLOW_HINT, "info"), 4000);
    try {
      await post(payload.path, payload.body);
      // No token yet: the account must verify its email with the emailed code.
      setPendingEmail(payload.body.email.trim().toLowerCase());
      location.href = "verify-email.html";
    } catch (err) {
      setLoading(submit, false);
      showAlert(alertEl, err.message);
    } finally {
      clearTimeout(slow);
    }
  });
}
