// Shared view pieces.

import { h, badge, formatDate } from "../ui.js";
import { groupLabel } from "../constants.js";
import { icon } from "../icons.js";

export const verifiedBadge = (verified) =>
  h("span", { class: `badge ${verified ? "badge-yes" : "badge-no"}` }, verified ? "Verified" : "Pending verification");

/** One cell of a stat strip (wrap cells in <div class="kpis">). tone colours the number. */
export function kpi(ico, value, label, tone = "", sub = "") {
  return h("div", { class: `kpi${tone && tone !== "grey" && tone !== "blue" ? ` tone-${tone}` : ""}` },
    h("div", { class: "kpi-label" }, icon(ico), label),
    h("b", {}, String(value)),
    sub ? h("small", {}, sub) : null);
}

const meta = (ico, text) => (text ? h("p", { class: "meta" }, icon(ico), h("span", {}, text)) : null);

/** Request card used on every donor-facing list. Extra nodes go in the footer. */
export function requestCard(r, ...extra) {
  const where = [r.hospital_address, r.hospital_city, r.hospital_region].filter(Boolean).join(", ");
  return h(
    "article",
    { class: `req-card urg-${r.urgency}` },
    h("div", { class: "req-blood" }, h("b", {}, groupLabel(r.blood_type)), h("span", {}, `${r.units_needed} unit${r.units_needed === 1 ? "" : "s"}`)),
    h("div", { class: "req-body" },
      h("div", { class: "req-top" },
        h("h3", {}, r.hospital_name),
        verifiedBadge(r.hospital_verified),
        h("span", { class: "spacer" }),
        badge(r.urgency),
        r.status !== "open" ? badge(r.status) : null),
      meta("pin", where),
      meta("clock", `Posted ${formatDate(r.created_at)}`),
      r.note ? h("p", { class: "note" }, r.note) : null,
      extra.filter(Boolean).length ? h("div", { class: "req-foot" }, ...extra) : null)
  );
}

/** Fill the page title/subtitle. */
export function setHeading(title, sub) {
  if (title != null) document.getElementById("page-title").textContent = title;
  if (sub != null) document.getElementById("page-sub").textContent = sub;
}

/** Empty state with an icon. */
export function emptyBlock(ico, title, text) {
  return h("div", { class: "empty-block" }, icon(ico), h("strong", {}, title), h("p", {}, text));
}
