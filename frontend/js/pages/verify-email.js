import { auth } from "../api.js";
import { getPendingEmail, setPendingEmail } from "../auth.js";
import { mountShell } from "../shell.js";
import { h, field, showAlert, clearAlert, setLoading, clearFieldErrors, showFieldErrors, toast } from "../ui.js";
import { redirectIfSignedIn, otpField, resendButton, finishSignIn, normEmail } from "./otp.js";

redirectIfSignedIn();
mountShell();

const alertEl = document.getElementById("alert");
let email = getPendingEmail();
let wrongTries = 0;

const intro = h("p", { class: "muted", "aria-live": "polite" });
const submit = h("button", { type: "submit", class: "btn btn-primary btn-block lp-btn-lg" }, "Verify");
const form = h(
  "form",
  { class: "card", novalidate: true },
  h("h2", {}, "Check your email"),
  intro,
  email ? null : field({ label: "Email", name: "email", type: "email", autocomplete: "email" }),
  otpField(),
  h("p", { class: "hint" }, "It can take a few seconds to arrive. Check your spam folder if you don't see it. The code expires in 10 minutes."),
  submit
);

const resend = resendButton(async () => {
  const addr = email || normEmail(form.elements.email?.value || "");
  if (!addr) return;
  try {
    await auth.resendOtp(addr);
  } catch {
    /* the response is always neutral */
  }
  wrongTries = 0;
  toast("If your account needs verification, a new code is on its way.", "info");
});

if (email) intro.append("We sent a 6-digit code to ", h("strong", {}, email), ".");
else intro.append("Enter your email and the 6-digit code we sent you.");

document.getElementById("app").append(
  form,
  h("div", { style: "margin-top:12px" }, resend.el),
  h("p", { class: "auth-switch" }, "Wrong email? ", h("a", { href: "register-donor.html" }, "Register again"), " · ", h("a", { href: "login.html" }, "Log in"))
);
(email ? form.elements.otp : form.elements.email).focus();

// Arrived from login with an unverified account: the old code may have expired, so send a new one.
if (new URLSearchParams(location.search).get("resend") && email) {
  history.replaceState(null, "", location.pathname);
  auth.resendOtp(email).catch(() => {});
  toast("If your account needs verification, a new code is on its way.", "info");
}

async function verify() {
  clearAlert(alertEl);
  clearFieldErrors(form);
  if (!email) {
    const typed = normEmail(form.elements.email.value);
    if (!typed || !form.elements.email.checkValidity()) return showFieldErrors(form, { email: "Enter the email you registered with." });
    email = typed;
    setPendingEmail(email);
  }
  const otp = form.elements.otp.value.trim();
  if (!/^\d{6}$/.test(otp)) return showFieldErrors(form, { otp: "Enter the 6-digit code." });

  setLoading(submit, true, "Verifying…");
  form.elements.otp.disabled = true;
  try {
    finishSignIn(await auth.verifyEmail(email, otp));
  } catch (err) {
    setLoading(submit, false);
    form.elements.otp.disabled = false;
    form.elements.otp.value = "";
    form.elements.otp.focus();
    if (err.status === 400) {
      wrongTries += 1;
      showFieldErrors(form, { otp: err.message });
      if (wrongTries >= 5) showAlert(alertEl, "Too many wrong tries. Request a new code to continue.");
    } else {
      showAlert(alertEl, err.message);
    }
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  verify();
});
form.elements.otp.addEventListener("input", () => {
  if (form.elements.otp.value.length === 6 && !submit.disabled) verify();
});
