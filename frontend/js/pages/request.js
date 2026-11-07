import { get, post, patch } from "../api.js";
import { requireLogin, bindLogout } from "../auth.js";
import { URGENCY, groupLabel } from "../constants.js";
import { h, badge, yesNoBadge, formatDate, showAlert, clearAlert, setLoading, loadingRow, emptyState } from "../ui.js";

const id = new URLSearchParams(location.search).get("id");
const alertEl = document.getElementById("alert");
const detailEl = document.getElementById("detail");
const sectionEl = document.getElementById("matches-section");
const matchesEl = document.getElementById("matches");
const notifyBtn = document.getElementById("notify");

let current = null; // the request
let matches = [];

if (requireLogin()) init();

async function init() {
  bindLogout();
  if (!id) {
    detailEl.replaceChildren(emptyState("No request selected."));
    return;
  }

  notifyBtn.addEventListener("click", notifyDonors);

  try {
    current = await get(`/requests/${encodeURIComponent(id)}`);
  } catch (err) {
    detailEl.replaceChildren();
    showAlert(alertEl, err.status === 404 ? "We couldn't find that request." : err.message);
    return;
  }
  renderSummary();
  sectionEl.hidden = false;
  await loadMatches();
}

// ---------- Summary ----------

function renderSummary() {
  const r = current;
  const urgency = URGENCY[r.urgency]?.label || r.urgency;
  document.title = `${groupLabel(r.blood_group)} · ${urgency} · BloodLink`;

  const items = [
    ["Blood group", h("span", { class: "group-chip" }, groupLabel(r.blood_group))],
    ["Units", String(r.units ?? "—")],
    ["Urgency", badge(r.urgency)],
    ["Status", badge(r.status)],
  ];

  const dl = h(
    "dl",
    { class: "summary" },
    items.map(([label, value]) => h("div", {}, h("dt", {}, label), h("dd", {}, value))),
    h("div", { class: "full" }, h("dt", {}, "Created"), h("dd", {}, formatDate(r.created_at))),
    r.note ? h("div", { class: "full" }, h("dt", {}, "Note"), h("dd", { class: "note" }, r.note)) : null
  );

  const actions = h("div", { class: "actions", style: "margin-top: 16px" });
  if (r.status === "open") {
    actions.append(
      h("button", { type: "button", class: "btn btn-secondary", onclick: (e) => changeStatus(e.currentTarget, "fulfilled") }, "Mark fulfilled"),
      h("button", { type: "button", class: "btn btn-danger", onclick: (e) => changeStatus(e.currentTarget, "cancelled") }, "Cancel request")
    );
  } else {
    actions.append(
      h("button", { type: "button", class: "btn btn-secondary", onclick: (e) => changeStatus(e.currentTarget, "open") }, "Reopen request")
    );
  }

  detailEl.replaceChildren(
    h(
      "div",
      { class: "card" },
      h("h1", {}, `${groupLabel(r.blood_group)} request`),
      dl,
      actions
    )
  );
  updateNotifyButton();
}

const CONFIRM_TEXT = {
  fulfilled: "Mark this request as fulfilled? Donors will no longer be asked to help.",
  cancelled: "Cancel this request? Donors will no longer be asked to help.",
  open: "Reopen this request?",
};

const DONE_TEXT = {
  fulfilled: "Request marked as fulfilled.",
  cancelled: "Request cancelled.",
  open: "Request reopened.",
};

async function changeStatus(btn, status) {
  if (!confirm(CONFIRM_TEXT[status])) return;
  clearAlert(alertEl);
  setLoading(btn, true, "Saving…");
  try {
    const updated = await patch(`/requests/${encodeURIComponent(id)}`, { status });
    current = { ...current, ...(updated && typeof updated === "object" ? updated : {}), status };
    renderSummary();
    showAlert(alertEl, DONE_TEXT[status], "success");
  } catch (err) {
    setLoading(btn, false);
    showAlert(alertEl, err.message);
  }
}

// ---------- Matches ----------

async function loadMatches() {
  matchesEl.replaceChildren(loadingRow("Finding matching donors…"));
  try {
    const data = await get(`/requests/${encodeURIComponent(id)}/matches`);
    matches = (Array.isArray(data) ? data : data?.matches || []).slice();
    matches.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
    renderMatches();
  } catch (err) {
    matches = [];
    matchesEl.replaceChildren();
    showAlert(alertEl, err.message);
  }
  updateNotifyButton();
}

function formatKm(km) {
  if (km == null || Number.isNaN(Number(km))) return "—";
  const n = Number(km);
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} km`;
}

function renderMatches() {
  if (!matches.length) {
    matchesEl.replaceChildren(emptyState("No matching donors nearby yet."));
    return;
  }

  // Only the fields below are ever rendered: no phone numbers.
  const rows = matches.map((m) =>
    h(
      "tr",
      {},
      h("td", {}, m.first_name || "Donor"),
      h("td", {}, h("span", { class: "group-chip" }, groupLabel(m.blood_group))),
      h("td", { class: "num" }, formatKm(m.distance_km)),
      h("td", {}, yesNoBadge(m.eligible, "Eligible", "Not yet")),
      h("td", {}, yesNoBadge(m.notified, "Notified", "Not yet"))
    )
  );

  matchesEl.replaceChildren(
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h("caption", { class: "visually-hidden" }, "Matched donors, closest first"),
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { scope: "col" }, "Donor"),
            h("th", { scope: "col" }, "Blood group"),
            h("th", { scope: "col", class: "num" }, "Distance"),
            h("th", { scope: "col" }, "Eligible"),
            h("th", { scope: "col" }, "Notified")
          )
        ),
        h("tbody", {}, rows)
      )
    )
  );
}

function updateNotifyButton() {
  if (notifyBtn.getAttribute("aria-busy")) return;
  const isOpen = current?.status === "open";
  const pending = matches.filter((m) => m.eligible && !m.notified).length;
  notifyBtn.disabled = !isOpen || pending === 0;
  notifyBtn.title = !isOpen
    ? "Only open requests can notify donors."
    : pending === 0
      ? "All eligible donors have already been notified."
      : "";
}

async function notifyDonors() {
  clearAlert(alertEl);
  setLoading(notifyBtn, true, "Notifying…");
  try {
    const res = await post(`/requests/${encodeURIComponent(id)}/notify`);
    setLoading(notifyBtn, false);
    const n = res?.notified;
    showAlert(
      alertEl,
      typeof n === "number" ? `Notified ${n} donor${n === 1 ? "" : "s"}.` : "Matched donors have been notified.",
      "success"
    );
    await loadMatches();
  } catch (err) {
    setLoading(notifyBtn, false);
    updateNotifyButton();
    showAlert(alertEl, err.message);
  }
}
