import { post } from "../api.js";
import { BLOOD_GROUPS, groupLabel } from "../constants.js";
import { h, showAlert, clearAlert, setLoading, clearFieldErrors, showFieldErrors } from "../ui.js";

const form = document.getElementById("donor-form");
const alertEl = document.getElementById("alert");
const select = form.elements.blood_group;
const locateBtn = document.getElementById("locate");
const locationStatus = document.getElementById("location-status");

BLOOD_GROUPS.forEach((g) => select.append(h("option", { value: g }, groupLabel(g))));

// Don't allow a last-donation date in the future.
form.elements.last_donation_date.max = new Date().toISOString().slice(0, 10);

locateBtn.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    locationStatus.textContent = "Your browser can't share location. Your area/town is enough.";
    return;
  }
  setLoading(locateBtn, true, "Finding you…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      form.elements.lat.value = pos.coords.latitude.toFixed(5);
      form.elements.lng.value = pos.coords.longitude.toFixed(5);
      setLoading(locateBtn, false);
      locateBtn.textContent = "Update location";
      locateBtn.dataset.label = "Update location";
      locationStatus.textContent = "✓ Location added";
      locationStatus.classList.add("ok");
    },
    (err) => {
      setLoading(locateBtn, false);
      locationStatus.classList.remove("ok");
      locationStatus.textContent =
        err.code === err.PERMISSION_DENIED
          ? "Location permission was blocked. Your area/town is enough."
          : "We couldn't get your location. Try again, or just use your area/town.";
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
  );
});

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
    await post("/donors", payload);
    location.href = "thanks.html";
  } catch (err) {
    setLoading(submit, false);
    const matched = showFieldErrors(form, err.fields);
    showAlert(alertEl, matched ? "Please fix the highlighted fields." : err.message);
  }
});
