import { post } from "../api.js";
import { requireLogin, bindLogout } from "../auth.js";
import { BLOOD_GROUPS, groupLabel } from "../constants.js";
import { h, showAlert, clearAlert, setLoading, clearFieldErrors, showFieldErrors } from "../ui.js";

if (requireLogin()) init();

function init() {
  bindLogout();

  const form = document.getElementById("request-form");
  const alertEl = document.getElementById("alert");
  BLOOD_GROUPS.forEach((g) => form.elements.blood_group.append(h("option", { value: g }, groupLabel(g))));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertEl);
    clearFieldErrors(form);

    const f = form.elements;
    const units = Number(f.units.value);
    const errors = {};
    if (!f.blood_group.value) errors.blood_group = "Choose the blood group you need.";
    if (!Number.isInteger(units) || units < 1) errors.units = "Enter a whole number of at least 1.";
    else if (units > 50) errors.units = "That's more than 50 units. Please check the number.";
    if (Object.keys(errors).length) {
      showFieldErrors(form, errors);
      return;
    }

    const payload = {
      blood_group: f.blood_group.value,
      units,
      urgency: f.urgency.value,
    };
    const note = f.note.value.trim();
    if (note) payload.note = note;

    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Creating…");
    try {
      const created = await post("/requests", payload);
      const id = created?.id ?? created?.request?.id;
      location.href = id != null ? `request.html?id=${encodeURIComponent(id)}` : "dashboard.html";
    } catch (err) {
      setLoading(submit, false);
      const matched = showFieldErrors(form, err.fields);
      showAlert(alertEl, matched ? "Please fix the highlighted fields." : err.message);
    }
  });
}
