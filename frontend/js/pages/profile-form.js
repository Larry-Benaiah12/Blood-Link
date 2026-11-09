// Shared profile editor for donors and hospitals (GET/PUT /me).

import { get, put } from "../api.js";
import { getUser, saveUser } from "../auth.js";
import { h, field, showAlert, clearAlert, setLoading, loadingRow, validate, toast } from "../ui.js";
import { REGIONS, PHONE_RE } from "../constants.js";
import { required, maxLen, both } from "./register.js";

const phoneRule = (v) => (PHONE_RE.test(v.replace(/\s+/g, "")) ? "" : "Use a Ghana number: 0XXXXXXXXX or +233XXXXXXXXX.");

const SPECS = {
  donor: {
    path: "/api/donors/me",
    readonly: (p) => [["Blood type", String(p.blood_type).replace("-", "−")]],
    fields: (p) => [
      field({ label: "Phone", name: "phone", type: "tel", value: p.phone }),
      field({ label: "Region", name: "region", options: REGIONS }),
      field({ label: "City / town", name: "city", maxlength: 80, value: p.city }),
      field({ label: "GPS address", name: "gps_address", required: false, optional: true, maxlength: 30, value: p.gps_address || "" }),
      field({ label: "Last donation date", name: "last_donation_date", type: "date", required: false, optional: true, max: new Date().toISOString().slice(0, 10), value: p.last_donation_date || "" }),
      h("div", { class: "form-field span-2" },
        h("label", { class: "checkbox" }, h("input", { type: "checkbox", name: "is_available", checked: p.is_available ? "" : null }), " I'm available to donate"),
        h("span", { class: "hint" }, "While off, you see no requests and get no notifications.")),
    ],
    rules: {
      phone: phoneRule,
      region: required("Choose your region."),
      city: both(required("Please enter your city or town."), maxLen("City is too long (max 80).", 80)),
      gps_address: maxLen("GPS address is too long (max 30).", 30),
    },
    body: (f) => ({
      phone: f.phone.value.replace(/\s+/g, ""),
      region: f.region.value,
      city: f.city.value.trim(),
      gps_address: f.gps_address.value.trim() || null,
      last_donation_date: f.last_donation_date.value || null,
      is_available: f.is_available.checked,
    }),
  },
  hospital: {
    path: "/api/hospitals/me",
    readonly: (p) => [["Verification", p.is_verified ? "Verified" : "Pending"]],
    fields: (p) => [
      field({ label: "Hospital name", name: "name", maxlength: 160, value: p.name }),
      field({ label: "Phone", name: "phone", type: "tel", value: p.phone }),
      field({ label: "Region", name: "region", options: REGIONS }),
      field({ label: "City / town", name: "city", maxlength: 80, value: p.city }),
      field({ label: "Street address", name: "address", value: p.address, wrapClass: "span-2" }),
      field({ label: "GPS address", name: "gps_address", required: false, optional: true, maxlength: 30, value: p.gps_address || "" }),
    ],
    rules: {
      name: both(required("Please enter the hospital name."), maxLen("Name is too long (max 160).", 160)),
      phone: phoneRule,
      region: required("Choose your region."),
      city: both(required("Please enter your city or town."), maxLen("City is too long (max 80).", 80)),
      address: required("Please enter the street address."),
      gps_address: maxLen("GPS address is too long (max 30).", 30),
    },
    body: (f) => ({
      name: f.name.value.trim(),
      phone: f.phone.value.replace(/\s+/g, ""),
      region: f.region.value,
      city: f.city.value.trim(),
      address: f.address.value.trim(),
      gps_address: f.gps_address.value.trim() || null,
    }),
  },
};

export async function mountProfile(role, { onLoaded } = {}) {
  const spec = SPECS[role];
  const app = document.getElementById("app");
  const alertEl = document.getElementById("alert");
  app.replaceChildren(loadingRow("Loading profile…"));

  let profile;
  try {
    profile = await get(spec.path);
  } catch (err) {
    app.replaceChildren();
    showAlert(alertEl, err.message);
    return;
  }
  onLoaded?.(profile);

  const form = h(
    "form",
    { class: "card", novalidate: true },
    h("div", { class: "profile-head" },
      h("span", { class: "avatar" }, (profile.full_name || profile.name || "?").split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join("")),
      h("div", {}, h("h2", {}, profile.full_name || profile.name), h("p", {}, profile.email))),
    h("dl", { class: "summary", style: "margin-bottom:20px" },
      spec.readonly(profile).map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))),
    h("div", { class: "form-grid" }, spec.fields(profile)),
    h("div", { class: "actions" }, h("button", { type: "submit", class: "btn btn-primary lp-btn-lg" }, "Save changes"))
  );
  form.elements.region.value = profile.region;
  app.replaceChildren(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertEl);
    if (!validate(form, spec.rules)) return;
    const btn = form.querySelector('[type="submit"]');
    setLoading(btn, true, "Saving…");
    try {
      const updated = await put(spec.path, spec.body(form.elements));
      const user = getUser();
      if (user) saveUser({ ...user, profile: updated });
      onLoaded?.(updated);
      toast("Profile saved.");
    } catch (err) {
      showAlert(alertEl, err.message);
    } finally {
      setLoading(btn, false);
    }
  });
}
