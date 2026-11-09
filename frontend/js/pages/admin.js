import { get, patch } from "../api.js";
import { requireRole, getUser } from "../auth.js";
import { mountShell } from "../shell.js";
import { BLOOD_GROUPS, REGIONS, groupLabel } from "../constants.js";
import { h, field, badge, formatDate, formatDay, showAlert, clearAlert, setLoading, loadingRow, emptyState, toast } from "../ui.js";
import { verifiedBadge, kpi } from "./parts.js";
import { icon } from "../icons.js";

mountShell();

const TABS = [["stats", "Overview"], ["donors", "Donors"], ["hospitals", "Hospitals"], ["requests", "Requests"]];
const app = document.getElementById("app");
const alertEl = document.getElementById("alert");
const me = getUser();


const tab = () => (TABS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : "stats");

async function route() {
  clearAlert(alertEl);
  const t = tab();
  document.getElementById("page-title").textContent = TABS.find(([k]) => k === t)[1];
  const body = h("div", {}, loadingRow("Loading…"));
  app.replaceChildren(body);
  try {
    await { stats, donors, hospitals, requests }[t](body);
  } catch (err) {
    body.replaceChildren();
    showAlert(alertEl, err.message);
  }
}

const table = (caption, heads, rows) =>
  h("div", { class: "table-wrap" },
    h("table", { class: "table" },
      h("caption", { class: "visually-hidden" }, caption),
      h("thead", {}, h("tr", {}, heads.map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, rows)));

// ---------- Overview ----------

async function stats(body) {
  const s = await get("/api/admin/stats");
    const max = Math.max(1, ...BLOOD_GROUPS.map((g) => s.donors_by_blood_type?.[g] || 0));
  body.replaceChildren(
    h("div", { class: "kpis" }, kpi("users", s.total_donors, "Donors", "red"), kpi("hospital", s.total_hospitals, "Hospitals", "blue"), kpi("list", s.total_requests, "Requests", "amber"), kpi("checkCircle", s.accepted_responses, "Accepted responses", "green")),
    h("div", { class: "card" }, h("h2", {}, icon("droplet"), "Donors by blood type"),
      h("ul", { class: "bars" }, BLOOD_GROUPS.map((g) => {
        const n = s.donors_by_blood_type?.[g] || 0;
        return h("li", {}, h("span", { class: "group-chip" }, groupLabel(g)), h("i", { style: `width:${(n / max) * 100}%` }), h("span", {}, String(n)));
      })))
  );
}

// ---------- Shared: activate / deactivate ----------

function activeButton(profile, rerender) {
  const btn = h("button", { type: "button", class: `btn ${profile.is_active ? "btn-danger" : "btn-secondary"}` }, profile.is_active ? "Deactivate" : "Reactivate");
  if (profile.user_id === me?.id) {
    btn.disabled = true;
    btn.title = "You can't deactivate yourself.";
  }
  btn.addEventListener("click", async () => {
    const next = !profile.is_active;
    if (!next && !confirm("Deactivate this account? They will be signed out and unable to log in.")) return;
    setLoading(btn, true, "Saving…");
    try {
      await patch(`/api/admin/users/${profile.user_id}/active`, { is_active: next });
      profile.is_active = next;
      toast(next ? "Account reactivated." : "Account deactivated.");
      rerender();
    } catch (err) {
      setLoading(btn, false);
      showAlert(alertEl, err.message);
    }
  });
  return btn;
}

const statusBadge = (active) => h("span", { class: `badge ${active ? "badge-yes" : "badge-no"}` }, active ? "Active" : "Deactivated");

// ---------- Donors ----------

async function donors(body) {
  const filters = h("form", { class: "toolbar" },
    field({ label: "Blood type", name: "blood_type", options: BLOOD_GROUPS.map((g) => [g, groupLabel(g)]), required: false }),
    field({ label: "Region", name: "region", options: REGIONS, required: false }),
    h("button", { type: "submit", class: "btn btn-primary" }, "Filter"));
  const results = h("div", {}, loadingRow("Loading donors…"));
  body.replaceChildren(filters, results);

  const load = async () => {
    const q = new URLSearchParams();
    if (filters.elements.blood_type.value) q.set("blood_type", filters.elements.blood_type.value);
    if (filters.elements.region.value) q.set("region", filters.elements.region.value);
    results.replaceChildren(loadingRow("Loading donors…"));
    try {
      const list = await get(`/api/admin/donors${q.size ? `?${q}` : ""}`);
      const draw = () => results.replaceChildren(
        list.length
          ? table("Donors", ["Name", "Blood", "Region / city", "Contact", "Last donation", "Available", "Status", ""],
              list.map((d) => h("tr", {},
                h("td", {}, d.full_name),
                h("td", {}, h("span", { class: "group-chip" }, groupLabel(d.blood_type))),
                h("td", {}, `${d.region} · ${d.city}`),
                h("td", {}, h("div", {}, d.email), h("a", { href: `tel:${d.phone}` }, d.phone)),
                h("td", {}, formatDay(d.last_donation_date)),
                h("td", {}, h("span", { class: `badge ${d.is_available ? "badge-yes" : "badge-no"}` }, d.is_available ? "Yes" : "No")),
                h("td", {}, statusBadge(d.is_active)),
                h("td", {}, activeButton(d, draw)))))
          : emptyState("No donors match these filters."));
      draw();
    } catch (err) {
      results.replaceChildren();
      showAlert(alertEl, err.message);
    }
  };
  filters.addEventListener("submit", (e) => { e.preventDefault(); clearAlert(alertEl); load(); });
  await load();
}

// ---------- Hospitals ----------

async function hospitals(body) {
  const list = await get("/api/admin/hospitals");
  const draw = () => body.replaceChildren(
    list.length
      ? table("Hospitals", ["Hospital", "Region / city", "Contact", "Verification", "Status", ""],
          list.map((x) => {
            const verify = h("button", { type: "button", class: "btn btn-primary" }, "Verify");
            verify.addEventListener("click", async () => {
              setLoading(verify, true, "Verifying…");
              try {
                await patch(`/api/admin/hospitals/${x.id}/verify`);
                x.is_verified = true;
                toast(`${x.name} verified.`);
                draw();
              } catch (err) {
                setLoading(verify, false);
                showAlert(alertEl, err.message);
              }
            });
            return h("tr", {},
              h("td", {}, h("div", {}, h("strong", {}, x.name)), h("div", { class: "muted small" }, x.address)),
              h("td", {}, `${x.region} · ${x.city}`),
              h("td", {}, h("div", {}, x.email), h("a", { href: `tel:${x.phone}` }, x.phone)),
              h("td", {}, x.is_verified ? verifiedBadge(true) : verify),
              h("td", {}, statusBadge(x.is_active)),
              h("td", {}, activeButton(x, draw)));
          }))
      : emptyState("No hospitals have registered yet."));
  draw();
}

// ---------- Requests ----------

async function requests(body) {
  const filters = h("form", { class: "toolbar" },
    field({ label: "Status", name: "status", options: [["open", "Open"], ["fulfilled", "Fulfilled"], ["cancelled", "Cancelled"]], required: false }),
    h("button", { type: "submit", class: "btn btn-primary" }, "Filter"));
  const results = h("div", {}, loadingRow("Loading requests…"));
  body.replaceChildren(filters, results);

  const load = async () => {
    const status = filters.elements.status.value;
    results.replaceChildren(loadingRow("Loading requests…"));
    try {
      const list = await get(`/api/admin/requests${status ? `?status=${encodeURIComponent(status)}` : ""}`);
      results.replaceChildren(
        list.length
          ? table("Blood requests", ["Hospital", "Blood", "Units", "Urgency", "Status", "Created"],
              list.map((r) => h("tr", {},
                h("td", {}, h("div", {}, r.hospital_name), h("div", { class: "muted small" }, `${r.hospital_city}, ${r.hospital_region}`)),
                h("td", {}, h("span", { class: "group-chip" }, groupLabel(r.blood_type))),
                h("td", { class: "num" }, String(r.units_needed)),
                h("td", {}, badge(r.urgency)),
                h("td", {}, badge(r.status)),
                h("td", {}, formatDate(r.created_at)))))
          : emptyState("No requests found."));
    } catch (err) {
      results.replaceChildren();
      showAlert(alertEl, err.message);
    }
  };
  filters.addEventListener("submit", (e) => { e.preventDefault(); clearAlert(alertEl); load(); });
  await load();
}

if (requireRole("admin")) {
  addEventListener("hashchange", route);
  route();
}
