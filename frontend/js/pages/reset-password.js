import { auth } from "../api.js";
import { getPendingEmail, setPendingEmail, setFlash, takeFlash } from "../auth.js";
import { mountShell } from "../shell.js";
import { h, field, showAlert, clearAlert, setLoading, validate, toast } from "../ui.js";
import { redirectIfSignedIn, otpField, resendButton, normEmail } from "./otp.js";

redirectIfSignedIn();
mountShell();

const alertEl = document.getElementById("alert");
const flash = takeFlash();
if (flash) showAlert(alertEl, flash, "info");

const show = h("label", { class: "checkbox" }, h("input", { type: "checkbox" }), " Show password");

const form = h(
  "form",
  { class: "card", novalidate: true },
  h("h2", {}, "Choose a new password"),
  field({ label: "Email", name: "email", type: "email", autocomplete: "email", value: getPendingEmail() }),
  otpField(),
  field({ label: "New password", name: "new_password", type: "password", autocomplete: "new-password", hint: "At least 8 characters." }),
  field({ label: "Confirm password", name: "confirm", type: "password", autocomplete: "new-password" }),
  h("div", { class: "form-field" }, show),
  h("button", { type: "submit", class: "btn btn-primary btn-block lp-btn-lg" }, "Update password")
);

show.querySelector("input").addEventListener("change", (e) => {
  const t = e.target.checked ? "text" : "password";
  form.elements.new_password.type = t;
  form.elements.confirm.type = t;
});

const resend = resendButton(async () => {
  const email = normEmail(form.elements.email.value);
  if (!email) return;
  try {
    await auth.forgot(email);
  } catch {
    /* neutral */
  }
  toast("If that email is registered, a new code is on its way.", "info");
});

document.getElementById("app").append(
  form,
  h("div", { style: "margin-top:12px" }, resend.el),
  h("p", { class: "auth-switch" }, h("a", { href: "login.html" }, "Back to log in"))
);
(form.elements.email.value ? form.elements.otp : form.elements.email).focus();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(alertEl);
  const f = form.elements;
  const ok = validate(form, {
    email: (v) => (v && f.email.checkValidity() ? "" : "Enter the email you used."),
    otp: (v) => (/^\d{6}$/.test(v) ? "" : "Enter the 6-digit code."),
    new_password: (v) => (f.new_password.value.length >= 8 ? "" : "Use at least 8 characters."),
    confirm: () => (f.confirm.value === f.new_password.value ? "" : "Passwords don't match."),
  });
  if (!ok) return;
  const btn = form.querySelector('[type="submit"]');
  setLoading(btn, true, "Updating…");
  try {
    await auth.reset(normEmail(f.email.value), f.otp.value.trim(), f.new_password.value);
    setPendingEmail("");
    setFlash("Password updated. You can now sign in.");
    location.href = "login.html";
  } catch (err) {
    setLoading(btn, false);
    f.otp.value = "";
    f.otp.focus();
    showAlert(alertEl, err.status === 400 && /code/i.test(err.message) ? `${err.message}. Request a new code if needed.` : err.message);
  }
});
