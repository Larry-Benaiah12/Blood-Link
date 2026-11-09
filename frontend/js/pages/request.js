import { get, patch } from "../api.js";
import { requireRole } from "../auth.js";
import { mountShell } from "../shell.js";
import { URGENCY, groupLabel } from "../constants.js";
import { h, badge, formatDate, showAlert, clearAlert, setLoading, loadingRow, emptyState } from "../ui.js";
import { setHeading } from "./parts.js";

mountShell();

const id = new URLSearchParams(location.search).get("id");
const alertEl = document.getElementById("alert");
const app = document.getElementById("app");
let current = null;

if (requireRole("hospital")) init();

async function init() {
  if (!id) {
    app.replaceChildren(emptyState("No request selected."));
    return;
  }
  app.replaceChildren(loadingRow("Loading request…"));
  try {
    current = await get(`/api/requests/${encodeURIComponent(id)}`);
    render();
  } catch (err) {
    app.replaceChildren();
    showAlert(alertEl, err.status === 404 ? "We couldn't find that request." : err.message);
  }
}

function render() {
  const r = current;
  const urgency = URGENCY[r.urgency]?.label || r.urgency;
  document.title = `${groupLabel(r.blood_type)} · ${urgency} · BloodLink`;
  setHeading(`${groupLabel(r.blood_type)} request`, `${r.units_needed} unit${r.units_needed === 1 ? "" : "s"} · ${urgency}`);

  const dl = h("dl", { class: "summary" },
    [["Blood type", h("span", { class: "group-chip" }, groupLabel(r.blood_type))],
     ["Units", String(r.units_needed)], ["Urgency", badge(r.urgency)], ["Status", badge(r.status)]]
      .map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v))),
    h("div", { class: "full" }, h("dt", {}, "Created"), h("dd", {}, formatDate(r.created_at))),
    r.note ? h("div", { class: "full" }, h("dt", {}, "Note"), h("dd", { class: "note" }, r.note)) : null);

  const actions = h("div", { class: "actions", style: "margin-top:16px" });
  if (r.status === "open") {
    actions.append(
      h("button", { type: "button", class: "btn btn-secondary", onclick: (e) => changeStatus(e.currentTarget, "fulfilled") }, "Mark fulfilled"),
      h("button", { type: "button", class: "btn btn-danger", onclick: (e) => changeStatus(e.currentTarget, "cancelled") }, "Cancel request")
    );
  }

  app.replaceChildren(
    h("div", { class: "card" }, dl, actions),
    h("div", { class: "card", style: "margin-top:16px" }, h("h2", {}, `Donors who accepted (${current.accepted_donors?.length || 0})`), donorsTable(current.accepted_donors || []))
  );
}

function donorsTable(donors) {
  if (!donors.length) return emptyState("No donors have accepted yet. Matching donors have been notified.");
  return h("div", { class: "table-wrap" },
    h("table", { class: "table" },
      h("caption", { class: "visually-hidden" }, "Donors who accepted this request"),
      h("thead", {}, h("tr", {},
        ["Donor", "Blood type", "City", "Phone", "Accepted"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, donors.map((d) =>
        h("tr", {},
          h("td", {}, d.full_name),
          h("td", {}, h("span", { class: "group-chip" }, groupLabel(d.blood_type))),
          h("td", {}, d.city),
          h("td", {}, h("a", { href: `tel:${d.phone}` }, d.phone)),
          h("td", {}, formatDate(d.accepted_at)))))));
}

const CONFIRM = {
  fulfilled: "Mark this request as fulfilled? Donors will no longer be asked to help.",
  cancelled: "Cancel this request? Donors will no longer be asked to help.",
};

async function changeStatus(btn, status) {
  if (!confirm(CONFIRM[status])) return;
  clearAlert(alertEl);
  setLoading(btn, true, "Saving…");
  try {
    await patch(`/api/requests/${encodeURIComponent(id)}/status`, { status });
    current = { ...current, status };
    render();
    showAlert(alertEl, status === "fulfilled" ? "Request marked as fulfilled." : "Request cancelled.", "success");
  } catch (err) {
    setLoading(btn, false);
    showAlert(alertEl, err.message);
    if (err.status === 409) init(); // already closed elsewhere: refresh
  }
}
