import { get } from "../api.js";
import { requireRole, getProfile } from "../auth.js";
import { mountShell } from "../shell.js";
import { URGENCY, STATUS, BLOOD_GROUPS, groupLabel } from "../constants.js";
import { h, badge, formatDate, showAlert, loadingRow, emptyState } from "../ui.js";
import { setHeading, verifiedBadge, kpi, emptyBlock } from "./parts.js";
import { icon } from "../icons.js";

mountShell();

const rank = (map, key) => map[String(key).toLowerCase()]?.rank ?? 99;

// Open first, then critical → urgent → normal, then newest.
const sortRequests = (list) =>
  [...list].sort(
    (a, b) =>
      rank(STATUS, a.status) - rank(STATUS, b.status) ||
      rank(URGENCY, a.urgency) - rank(URGENCY, b.urgency) ||
      new Date(b.created_at) - new Date(a.created_at)
  );

function renderStats(a) {
  const max = Math.max(1, ...BLOOD_GROUPS.map((g) => a.requests_by_blood_type?.[g] || 0));
  return h(
    "section",
    {},
    h("div", { class: "kpis" },
      kpi("activity", a.open, "Open requests", "blue"), kpi("checkCircle", a.fulfilled, "Fulfilled", "green"),
      kpi("ban", a.cancelled, "Cancelled", "grey"), kpi("list", a.total_requests, "Total requests", "red"),
      kpi("heart", a.total_donors_accepted, "Donors accepted", "amber")),
    h("div", { class: "card", style: "margin-bottom:20px" },
      h("h2", {}, icon("droplet"), "Requests by blood type"),
      h("ul", { class: "bars" },
        BLOOD_GROUPS.map((g) => {
          const n = a.requests_by_blood_type?.[g] || 0;
          return h("li", {}, h("span", { class: "group-chip" }, groupLabel(g)), h("i", { style: `width:${(n / max) * 100}%` }), h("span", {}, String(n)));
        }))),
    h("h2", { class: "section-title" }, icon("list"), "Your requests")
  );
}

function renderTable(requests) {
  const rows = sortRequests(requests).map((r) =>
    h("tr", {},
      h("td", {}, h("span", { class: "group-chip" }, groupLabel(r.blood_type))),
      h("td", { class: "num" }, String(r.units_needed)),
      h("td", {}, badge(r.urgency)),
      h("td", {}, badge(r.status)),
      h("td", { class: "num" }, String(r.accepted_count ?? 0)),
      h("td", {}, formatDate(r.created_at)),
      h("td", {}, h("a", { href: `request.html?id=${encodeURIComponent(r.id)}`, "aria-label": `View ${groupLabel(r.blood_type)} request` }, "View"))
    )
  );
  return h("div", { class: "table-wrap" },
    h("table", { class: "table" },
      h("caption", { class: "visually-hidden" }, "Your blood requests, open and most urgent first"),
      h("thead", {}, h("tr", {},
        h("th", { scope: "col" }, "Blood type"), h("th", { scope: "col", class: "num" }, "Units"),
        h("th", { scope: "col" }, "Urgency"), h("th", { scope: "col" }, "Status"),
        h("th", { scope: "col", class: "num" }, "Accepted"), h("th", { scope: "col" }, "Created"),
        h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Actions")))),
      h("tbody", {}, rows)));
}

async function init() {
  const hospital = getProfile();
  if (hospital?.name) setHeading(hospital.name, "");
  const app = document.getElementById("app");
  const alertEl = document.getElementById("alert");
  app.replaceChildren(loadingRow("Loading your requests…"));

  const [me, analytics, requests] = await Promise.allSettled([get("/api/hospitals/me"), get("/api/hospitals/analytics"), get("/api/requests")]);
  const failed = [me, analytics, requests].find((r) => r.status === "rejected");
  if (failed) showAlert(alertEl, failed.reason.message);

  if (me.status === "fulfilled") {
    setHeading(me.value.name, "");
    document.getElementById("page-sub").replaceChildren(verifiedBadge(me.value.is_verified));
  }
  app.replaceChildren(
    ...(analytics.status === "fulfilled" ? [renderStats(analytics.value)] : []),
    ...(requests.status === "fulfilled"
      ? [requests.value.length ? renderTable(requests.value) : emptyBlock("inbox", "No requests yet", "Create one to notify matching donors in your region.")]
      : [])
  );
}

if (requireRole("hospital")) init();
