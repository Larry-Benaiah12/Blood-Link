import { get, post } from "../api.js";
import { requireLogin, bindLogout, getProfile } from "../auth.js";
import { BLOOD_GROUPS, groupLabel, donorCode } from "../constants.js";
import { h, showAlert, clearAlert, setLoading, clearFieldErrors, showFieldErrors } from "../ui.js";

// Donors must sign in first (Google or username/email).
const signedIn = requireLogin("donor");

const form = document.getElementById("donor-form");
const alertEl = document.getElementById("alert");
const select = form.elements.blood_group;
const locateBtn = document.getElementById("locate");
const locationStatus = document.getElementById("location-status");
let lastPlace = ""; // "Amasaman, Accra" from the location lookup, for the slip

BLOOD_GROUPS.forEach((g) => select.append(h("option", { value: g }, groupLabel(g))));

if (signedIn) {
  bindLogout();
  loadAccount();
}

/** Show who is signed in; send already-registered donors to their slip. */
async function loadAccount() {
  const bar = document.getElementById("account-bar");
  const showBar = (acc) => {
    if (!acc) return;
    const via = acc.provider === "google" ? "Google" : acc.email ? "email" : "username";
    bar.replaceChildren(
      h(
        "span",
        { class: "who" },
        acc.picture ? h("img", { src: acc.picture, alt: "", referrerpolicy: "no-referrer" }) : null,
        h("span", {}, "Signed in as ", h("strong", {}, acc.name || acc.email || acc.username), ` (${via})`)
      ),
      h("button", { type: "button", "data-logout": "" }, "Sign out")
    );
    bar.hidden = false;
    bindLogout();
  };
  showBar(getProfile());
  try {
    const me = await get("/donor/me");
    if (me?.donor) {
      location.replace("thanks.html"); // already registered: show their Donor ID / slip
      return;
    }
    showBar(me?.account);
    if (me?.account?.name && !form.elements.name.value) form.elements.name.value = me.account.name;
  } catch {
    /* api.js already sends expired sessions back to the sign-in page */
  }
}

// Don't allow a last-donation date in the future.
form.elements.last_donation_date.max = new Date().toISOString().slice(0, 10);

// Map-pin icon (filled marker with a hole), drawn in the current text colour.
const PIN_SVG =
  '<svg class="pin-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" fill-rule="evenodd" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>' +
  "</svg>";

function setStatus(text, state, withPin = false) {
  if (withPin) {
    locationStatus.innerHTML = PIN_SVG;
    locationStatus.append(document.createTextNode(text));
  } else {
    locationStatus.textContent = text;
  }
  locationStatus.classList.toggle("ok", state === "ok");
  locationStatus.classList.toggle("err", state === "err");
}

// Current permission state: "granted" | "prompt" | "denied" | "unknown".
async function permissionState() {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const res = await navigator.permissions.query({ name: "geolocation" });
    return res.state;
  } catch {
    return "unknown";
  }
}

// Fresh (live) GPS fix. Calling this triggers the browser's permission prompt if needed.
function getLivePosition() {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    })
  );
}

// Strip administrative suffixes so "Greater Accra Region" / "Ga West Municipal District" read cleanly.
function tidy(name) {
  return (name || "")
    .replace(/\s+(Metropolitan|Municipal|District|Assembly|Region)(\s+(District|Assembly))*$/i, "")
    .replace(/^Greater\s+/i, "")
    .trim();
}

// Turn coordinates into "Town, City" (e.g. "Amasaman, Accra") using OpenStreetMap.
async function reverseGeocode(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1` +
    `&accept-language=en&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Reverse geocoding failed");
  const a = (await res.json()).address || {};

  const town = a.suburb || a.neighbourhood || a.quarter || a.village || a.hamlet || a.town || a.city_district;
  const city = a.city || a.town || a.municipality || a.county || a.state_district || a.state;

  const parts = [tidy(town), tidy(city)].filter(Boolean);
  // Avoid "Accra, Accra".
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  return unique.join(", ");
}

locateBtn.addEventListener("click", async () => {
  if (!("geolocation" in navigator)) {
    setStatus("Your browser can't share location. Your area/town is enough.", "err");
    return;
  }
  if (!window.isSecureContext) {
    setStatus("Location only works over a secure (https) connection.", "err");
    return;
  }

  const state = await permissionState();
  if (state === "denied") {
    // Browsers don't allow re-prompting once blocked; the user must re-enable it.
    setStatus(
      "Location is blocked for this site. Tap the lock/ⓘ icon in the address bar, allow Location, then try again.",
      "err"
    );
    return;
  }
  if (state === "prompt") setStatus("Please tap “Allow” when your browser asks to share your location.");

  setLoading(locateBtn, true, "Finding you…");
  try {
    const pos = await getLivePosition();
    const lat = pos.coords.latitude.toFixed(5);
    const lng = pos.coords.longitude.toFixed(5);
    form.elements.lat.value = lat;
    form.elements.lng.value = lng;
    locateBtn.dataset.label = "Update location";

    setStatus("✓ Location found. Looking up your town…", "ok");
    try {
      const place = await reverseGeocode(lat, lng);
      if (place) {
        lastPlace = place;
        setStatus(place, "ok", true);
        const area = form.elements.area;
        if (!area.value.trim() || area.dataset.autofilled === "1") {
          area.value = place;
          area.dataset.autofilled = "1";
        }
      } else {
        setStatus("✓ Location added", "ok");
      }
    } catch {
      setStatus("✓ Location added (couldn't look up the town name)", "ok");
    }
  } catch (err) {
    if (err.code === err.PERMISSION_DENIED) {
      setStatus("You didn't allow location. Tap “Use my location” again and choose Allow, or just type your area/town.", "err");
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      setStatus("Your device's location (GPS) seems to be off. Turn on Location in your phone/computer settings, then try again.", "err");
    } else if (err.code === err.TIMEOUT) {
      setStatus("Finding your location took too long. Move near a window or turn on GPS, then try again.", "err");
    } else {
      setStatus("We couldn't get your location. Try again, or just type your area/town.", "err");
    }
  } finally {
    setLoading(locateBtn, false);
    if (form.elements.lat.value) locateBtn.textContent = "Update location";
  }
});

// If the donor edits the area by hand, stop overwriting it.
form.elements.area.addEventListener("input", () => delete form.elements.area.dataset.autofilled);

// Plain-language messages for the browser's own validation.
function localErrors() {
  const e = {};
  const f = form.elements;
  if (!f.name.value.trim()) e.name = "Please enter your name.";
  if (!f.phone.value.trim()) e.phone = "Please enter your phone number.";
  else if (!f.phone.checkValidity()) e.phone = "That doesn't look like a phone number.";
  if (!f.blood_group.value) e.blood_group = "Choose your blood group.";
  if (!f.area.value.trim()) e.area = "Tell us your area or town.";
  if (!f.last_donation_date.checkValidity()) e.last_donation_date = "This date can't be in the future.";
  if (!f.consent.checked) e.consent = "Please tick this so we can contact you.";
  return e;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAlert(alertEl);
  clearFieldErrors(form);

  const errors = localErrors();
  if (Object.keys(errors).length) {
    showFieldErrors(form, errors);
    return;
  }

  const f = form.elements;
  const payload = {
    name: f.name.value.trim(),
    phone: f.phone.value.trim(),
    blood_group: f.blood_group.value,
    area: f.area.value.trim(),
    lat: f.lat.value ? Number(f.lat.value) : null,
    lng: f.lng.value ? Number(f.lng.value) : null,
    last_donation_date: f.last_donation_date.value || null,
    consent: f.consent.checked,
  };

  const submit = form.querySelector('[type="submit"]');
  setLoading(submit, true, "Registering…");
  try {
    const res = await post("/donors", payload);
    // Keep the details for the registration slip on the thank-you page.
    const registration = {
      ...payload,
      ...(res?.donor || {}),
      donor_code: res?.donor_code || res?.donor?.donor_code || donorCode(res?.id),
      registered_at: res?.donor?.registered_at || new Date().toISOString(),
      location_shared: payload.lat != null,
      lat: payload.lat,
      lng: payload.lng,
      place: lastPlace,
    };
    try {
      sessionStorage.setItem("bloodlink_registration", JSON.stringify(registration));
    } catch { /* slip just won't show */ }
    location.href = "thanks.html";
  } catch (err) {
    setLoading(submit, false);
    const matched = showFieldErrors(form, err.fields);
    showAlert(alertEl, matched ? "Please fix the highlighted fields." : err.message);
  }
});
