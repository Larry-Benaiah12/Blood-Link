import { post } from "../api.js";
import { requireRole } from "../auth.js";
import { mountShell } from "../shell.js";
import { BLOOD_GROUPS, groupLabel } from "../constants.js";
import { h, field, showAlert, clearAlert, setLoading, validate } from "../ui.js";

mountShell();
if (requireRole("hospital")) init();

function init() {
  const alertEl = document.getElementById("alert");
  const form = h(
    "form",
    { class: "card", novalidate: true },
    field({ label: "Blood type needed", name: "blood_type", options: BLOOD_GROUPS.map((g) => [g, groupLabel(g)]) }),
    field({ label: "Units needed", name: "units_needed", type: "number", inputmode: "numeric", min: 1, max: 100, step: 1, value: 1 }),
    field({ label: "Urgency", name: "urgency", options: [["critical", "Critical: needed now"], ["urgent", "Urgent: within hours"], ["normal", "Normal"]] }),
    field({ label: "Note", name: "note", type: "textarea", required: false, optional: true, maxlength: 1000, hint: "Do not include patient names." }),
    h("div", { class: "actions" },
      h("button", { type: "submit", class: "btn btn-primary lp-btn-lg" }, "Create request"),
      h("a", { class: "btn btn-secondary lp-btn-lg", href: "dashboard.html" }, "Cancel"))
  );
  form.elements.urgency.value = "normal";
  document.getElementById("app").append(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertEl);
    const ok = validate(form, {
      blood_type: (v) => (v ? "" : "Choose the blood type you need."),
      units_needed: (v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 100 ? "" : "Enter a whole number from 1 to 100."),
      urgency: (v) => (v ? "" : "Choose an urgency."),
      note: (v) => (v.length > 1000 ? "Note is too long (max 1000)." : ""),
    });
    if (!ok) return;

    const f = form.elements;
    const body = { blood_type: f.blood_type.value, units_needed: Number(f.units_needed.value), urgency: f.urgency.value };
    if (f.note.value.trim()) body.note = f.note.value.trim();

    const submit = form.querySelector('[type="submit"]');
    setLoading(submit, true, "Creating…");
    try {
      const created = await post("/api/requests", body);
      location.href = `request.html?id=${encodeURIComponent(created.id)}`;
    } catch (err) {
      setLoading(submit, false);
      showAlert(alertEl, err.message);
    }
  });
}
