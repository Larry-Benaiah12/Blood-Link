// "Continue with Google" (Google Identity Services, ID-token flow).
// GIS gives us a signed ID token ("credential"); the API verifies it:
//   200/201 -> signed in            404 registration_required -> ask for a profile
// There is no redirect flow and no client secret here.

import { post } from "./api.js";
import { saveSession, homeFor } from "./auth.js";
import { GOOGLE_CLIENT_ID } from "./config.js";
import { BLOOD_GROUPS, REGIONS, groupLabel } from "./constants.js";
import { h, field, showAlert, clearAlert, setLoading, validate } from "./ui.js";
import { baseRules, required, maxLen, both } from "./pages/register.js";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SLOW_HINT = "Waking up the server — the first request can take up to a minute. Thanks for waiting…";

let gisPromise;
function loadGis() {
  gisPromise ||= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => {
      gisPromise = null;
      reject(new Error("Google sign-in couldn't load"));
    };
    document.head.append(s);
  });
  return gisPromise;
}

const G_LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
function googleLook() {
  const el = h("span", { class: "google-look", "aria-hidden": "true" }, "Continue with Google");
  el.insertAdjacentHTML("afterbegin", G_LOGO); // static constant, no user input
  return el;
}

function signIn({ access_token, user, role }) {
  saveSession(access_token, user);
  location.href = homeFor(role || user.role);
}

/**
 * Adds a "Continue with Google" button (with an "or" divider) to `container`.
 * `role` ("donor" | "hospital") pre-selects the role if a new profile is needed.
 */
export function mountGoogle({ container, alertEl, role }) {
  if (!GOOGLE_CLIENT_ID) return;

  // Our own styled button is what people see; Google's real button sits on top,
  // invisible, so the click still goes to Google's sign-in.
  const slot = h("div", { class: "google-real" });
  const wrap = h("div", { class: "google-wrap", hidden: true },
    h("p", { class: "or-divider" }, h("span", {}, "or")),
    h("div", { class: "google-btn" }, googleLook(), slot));
  container.append(wrap);

  loadGis()
    .then(() => {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: ({ credential }) => handleCredential(credential, { alertEl, role }),
      });
      wrap.hidden = false;
      google.accounts.id.renderButton(slot, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        width: Math.min(400, Math.max(200, Math.round(slot.clientWidth || 320))),
      });
    })
    // Blocked script (ad-blocker, offline): email/password stays available.
    .catch(() => {});
}

async function handleCredential(credential, { alertEl, role }) {
  clearAlert(alertEl);
  showAlert(alertEl, "Signing you in with Google…", "info");
  const slow = setTimeout(() => showAlert(alertEl, SLOW_HINT, "info"), 4000);
  try {
    signIn(await post("/api/auth/google", { id_token: credential }));
  } catch (err) {
    clearAlert(alertEl);
    if (err.status === 404 && err.code === "registration_required") {
      showProfileForm({ credential, email: err.data?.email, name: err.data?.name, role, alertEl });
    } else {
      showAlert(alertEl, err.message);
    }
  } finally {
    clearTimeout(slow);
  }
}

export function showProfileForm({ credential, email, name, role, alertEl }) {
  const roleField = field({
    label: "I am registering as a",
    name: "role",
    options: [["donor", "Blood donor"], ["hospital", "Hospital"]],
    value: role || "",
  });

  const common = [
    field({ label: "Phone", name: "phone", type: "tel", autocomplete: "tel", placeholder: "0241234567" }),
    field({ label: "Region", name: "region", options: REGIONS }),
    field({ label: "City / town", name: "city", maxlength: 80 }),
    field({ label: "GPS address", name: "gps_address", required: false, optional: true, maxlength: 30, placeholder: "GA-123-4567", hint: "Ghana Post GPS code." }),
  ];
  const donorOnly = h("div", { hidden: true },
    field({ label: "Full name", name: "full_name", autocomplete: "name", maxlength: 120, value: name || "" }),
    field({ label: "Blood type", name: "blood_type", options: BLOOD_GROUPS.map((g) => [g, groupLabel(g)]) }));
  const hospitalOnly = h("div", { hidden: true },
    field({ label: "Hospital name", name: "name", maxlength: 160 }),
    field({ label: "Street address", name: "address" }));

  const form = h("form", { class: "card", novalidate: true },
    h("h2", {}, "Complete your profile"),
    h("p", { class: "muted" }, "Signed in with Google as ", h("strong", {}, email || "your Google account"), ". Tell us a bit more to finish."),
    roleField, donorOnly, hospitalOnly, common,
    h("button", { type: "submit", class: "btn btn-primary btn-block lp-btn-lg" }, "Create account"));

  const sync = () => {
    donorOnly.hidden = form.elements.role.value !== "donor";
    hospitalOnly.hidden = form.elements.role.value !== "hospital";
  };
  form.elements.role.addEventListener("change", sync);
  sync();

  const shared = { phone: baseRules.phone, region: required("Choose your region."),
    city: both(required("Please enter your city or town."), maxLen("City is too long (max 80).", 80)),
    gps_address: maxLen("GPS address is too long (max 30).", 30) };
  const rules = {
    donor: { full_name: both(required("Please enter your full name."), maxLen("Name is too long (max 120).", 120)),
      blood_type: required("Choose your blood type."), ...shared },
    hospital: { name: both(required("Please enter the hospital name."), maxLen("Name is too long (max 160).", 160)),
      address: required("Please enter the street address."), ...shared },
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertEl);
    const f = form.elements;
    const chosen = f.role.value;
    if (!chosen) return validate(form, { role: required("Choose donor or hospital.") });
    if (!validate(form, { role: required(""), ...rules[chosen] })) return;

    const body = { id_token: credential, role: chosen, phone: f.phone.value.replace(/\s+/g, ""),
      city: f.city.value.trim(), region: f.region.value };
    if (f.gps_address.value.trim()) body.gps_address = f.gps_address.value.trim();
    if (chosen === "donor") Object.assign(body, { full_name: f.full_name.value.trim(), blood_type: f.blood_type.value });
    else Object.assign(body, { name: f.name.value.trim(), address: f.address.value.trim() });

    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Creating account…");
    const slow = setTimeout(() => showAlert(alertEl, SLOW_HINT, "info"), 4000);
    try {
      signIn(await post("/api/auth/google", body));
    } catch (err) {
      setLoading(submit, false);
      // The Google token lasts about an hour; after that the user must start over.
      showAlert(alertEl, err.status === 401 ? "Your Google sign-in expired. Please go back and continue with Google again." : err.message);
    } finally {
      clearTimeout(slow);
    }
  });

  document.getElementById("app").replaceChildren(
    form,
    h("p", { class: "auth-switch" }, h("a", { href: "", onclick: (e) => { e.preventDefault(); location.reload(); } }, "Back to log in options")));
}
