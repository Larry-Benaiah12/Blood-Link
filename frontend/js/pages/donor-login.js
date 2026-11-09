// Donor sign-in: Google (recommended) or a username/email + password account.

import { post } from "../api.js";
import { saveSession, clearSession, homeFor, getRole, getToken } from "../auth.js";
import { GOOGLE_CLIENT_ID } from "../config.js";
import { showAlert, clearAlert, setLoading, clearFieldErrors, showFieldErrors } from "../ui.js";

// Opening this page always asks donors for credentials (same as the hospital
// login). Staff who wander here stay signed in until a donor signs in.
if (getToken() && getRole() === "donor") clearSession();

const alertEl = document.getElementById("alert");
const signinForm = document.getElementById("signin-form");
const signupForm = document.getElementById("signup-form");

function finish({ token, account }) {
  if (!token) throw new Error("Sign-in worked but no session came back. Please try again.");
  saveSession(token, account, "donor");
  location.href = homeFor("donor");
}

// ---------- Tabs ----------

const tabs = [document.getElementById("tab-signin"), document.getElementById("tab-signup")];
function selectTab(tab, focus = false) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
  clearAlert(alertEl);
  if (focus) tab.focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    selectTab(tabs[(i + 1) % tabs.length], true);
  });
});
if (location.hash === "#create") selectTab(tabs[1]);

// ---------- Username / email + password ----------

signinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(alertEl);
  clearFieldErrors(signinForm);
  const f = signinForm.elements;
  const errors = {};
  if (!f.identifier.value.trim()) errors.identifier = "Enter your username or email.";
  if (!f.password.value) errors.password = "Enter your password.";
  if (Object.keys(errors).length) return showFieldErrors(signinForm, errors);

  const submit = signinForm.querySelector('[type="submit"]');
  setLoading(submit, true, "Signing in…");
  try {
    finish(await post("/auth/donor/login", { identifier: f.identifier.value.trim(), password: f.password.value }));
  } catch (err) {
    setLoading(submit, false);
    showFieldErrors(signinForm, err.fields);
    showAlert(alertEl, err.message);
    f.password.select();
  }
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(alertEl);
  clearFieldErrors(signupForm);
  const f = signupForm.elements;
  const identifier = f.identifier.value.trim();
  const password = f.password.value;
  const errors = {};
  if (!f.name.value.trim()) errors.name = "Please enter your full name.";
  if (!identifier) errors.identifier = "Choose a username or enter your email.";
  else if (identifier.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(identifier)) errors.identifier = "That doesn't look like an email address.";
  else if (!identifier.includes("@") && !/^[a-z0-9._]{3,30}$/i.test(identifier)) errors.identifier = "Usernames use 3–30 letters, numbers, dots or underscores.";
  if (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password)) errors.password = "Use at least 8 characters with letters and numbers.";
  if (!errors.password && f.confirm.value !== password) errors.confirm = "The passwords don't match.";
  if (Object.keys(errors).length) return showFieldErrors(signupForm, errors);

  const submit = signupForm.querySelector('[type="submit"]');
  setLoading(submit, true, "Creating account…");
  try {
    finish(await post("/auth/donor/register", { name: f.name.value.trim(), identifier, password }));
  } catch (err) {
    setLoading(submit, false);
    const matched = showFieldErrors(signupForm, err.fields);
    showAlert(alertEl, matched ? "Please fix the highlighted fields." : err.message);
  }
});

// ---------- Google ----------

async function signInWithGoogle(credential) {
  clearAlert(alertEl);
  try {
    finish(await post("/auth/google", { credential }));
  } catch (err) {
    showAlert(alertEl, err.message || "Google sign-in failed. Please try again.");
  }
}

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load Google sign-in. Check your connection, or use a username/email instead."));
    document.head.append(s);
  });
}

async function setupRealGoogle() {
  const slot = document.getElementById("google-btn");
  try {
    await loadGoogleScript();
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (res) => signInWithGoogle(res.credential),
      ux_mode: "popup",
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    const width = Math.min(400, Math.max(220, Math.round(slot.getBoundingClientRect().width || 320)));
    google.accounts.id.renderButton(slot, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill", logo_alignment: "center", width });
  } catch (err) {
    showAlert(alertEl, err.message, "info");
  }
}

// Demo mode: no client ID yet, so build an (unsigned) Google-style token from
// what the user types. The mock API accepts it; a real backend never would.
function setupDemoGoogle() {
  const btn = document.getElementById("google-demo-btn");
  const dialog = document.getElementById("google-demo");
  const form = document.getElementById("google-demo-form");
  btn.hidden = false;

  btn.addEventListener("click", () => {
    clearFieldErrors(form);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    form.elements.email.focus();
  });
  document.getElementById("gd-cancel").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const email = form.elements.email.value.trim().toLowerCase();
    const name = form.elements.name.value.trim();
    const errors = {};
    if (!/^[^\s@]+@(gmail\.com|googlemail\.com|[^\s@]+\.[^\s@]{2,})$/.test(email)) errors.email = "Enter a valid Google (Gmail) address.";
    if (!name) errors.name = "Enter your name.";
    if (Object.keys(errors).length) return showFieldErrors(form, errors);
    dialog.close();
    signInWithGoogle(fakeIdToken({ sub: `demo-${email}`, email, email_verified: true, name }));
  });
}

function b64url(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fakeIdToken(claims) {
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ iss: "demo", ...claims })}.demo`;
}

if (GOOGLE_CLIENT_ID) setupRealGoogle();
else setupDemoGoogle();
