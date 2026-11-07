import { get } from "../api.js";
import { requireLogin, bindLogout, getHospital } from "../auth.js";
import { URGENCY, STATUS, groupLabel } from "../constants.js";
import { h, badge, formatDate, showAlert, loadingRow, emptyState } from "../ui.js";

if (requireLogin()) init();

function rank(map, key) {
  return map[String(key).toLowerCase()]?.rank ?? 99;
}

// Open first, then critical → high → normal, then newest first.
function sortRequests(list) {
  return [...list].sort(
    (a, b) =>
      rank(STATUS, a.status) - rank(STATUS, b.status) ||
      rank(URGENCY, a.urgency) - rank(URGENCY, b.urgency) ||
      new Date(b.created_at) - new Date(a.created_at)
  );
}

function renderTable(requests) {
  const rows = sortRequests(requests).map((r) =>
    h(
      "tr",
      {},
      h("td", {}, h("span", { class: "group-chip" }, groupLabel(r.blood_group))),
      h("td", { class: "num" }, String(r.units ?? "—")),
      h("td", {}, badge(r.urgency)),
      h("td", {}, badge(r.status)),
      h("td", {}, formatDate(r.created_at)),
      h(
        "td",
        {},
        h("a", { href: `request.html?id=${encodeURIComponent(r.id)}`, "aria-label": `View ${groupLabel(r.blood_group)} request` }, "View")
      )
    )
  );

  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "table" },
      h("caption", { class: "visually-hidden" }, "Your blood requests, open and most urgent first"),
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { scope: "col" }, "Blood group"),
          h("th", { scope: "col", class: "num" }, "Units"),
          h("th", { scope: "col" }, "Urgency"),
          h("th", { scope: "col" }, "Status"),
          h("th", { scope: "col" }, "Created"),
          h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Actions"))
        )
      ),
      h("tbody", {}, rows)
    )
  );
}

async function init() {
  bindLogout();
  const hospital = getHospital();
  if (hospital?.name) document.getElementById("hospital-name").textContent = hospital.name;

  const box = document.getElementById("requests");
  box.replaceChildren(loadingRow("Loading requests…"));

  try {
    const data = await get("/requests");
    const requests = Array.isArray(data) ? data : data?.requests || [];
    box.replaceChildren(requests.length ? renderTable(requests) : emptyState("No requests yet."));
  } catch (err) {
    box.replaceChildren();
    showAlert(document.getElementById("alert"), err.message);
  }
}
