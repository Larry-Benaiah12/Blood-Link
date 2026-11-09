import { auth } from "../api.js";
import { setPendingEmail, setFlash } from "../auth.js";
import { mountShell } from "../shell.js";
import { h, field, showAlert, clearAlert, setLoading, validate } from "../ui.js";
import { redirectIfSignedIn, normEmail } from "./otp.js";

redirectIfSignedIn();
mountShell();

const alertEl = document.getElementById("alert");
const form = h(
  "form",
  { class: "card", novalidate: true },
  h("h2", {}, "Reset your password"),
  h("p", { class: "muted" }, "We'll email a 6-digit code if the address is registered."),
  field({ label: "Email", name: "email", type: "email", autocomplete: "email" }),
  h("button", { type: "submit", class: "btn btn-primary btn-block lp-btn-lg" }, "Send code")
);
document.getElementById("app").append(form, h("p", { class: "auth-switch" }, h("a", { href: "login.html" }, "Back to log in")));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(alertEl);
  const ok = validate(form, {
    email: (v) => (!v ? "Please enter your email." : form.elements.email.checkValidity() ? "" : "That doesn't look like an email address."),
  });
  if (!ok) return;
  const email = normEmail(form.elements.email.value);
  const btn = form.querySelector('[type="submit"]');
  setLoading(btn, true, "Sending…");
  try {
    await auth.forgot(email);
    setPendingEmail(email);
    setFlash("If that email is registered, we sent a code.");
    location.href = "reset-password.html";
  } catch (err) {
    setLoading(btn, false);
    showAlert(alertEl, err.message);
  }
});
