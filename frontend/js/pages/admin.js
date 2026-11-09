import { get, post, patch, del } from "../api.js";
import { requireLogin, bindLogout } from "../auth.js";
import { BLOOD_GROUPS, groupLabel } from "../constants.js";
import { h, showAlert, clearAlert, emptyState, clearFieldErrors, showFieldErrors } from "../ui.js";
import {
  GRANULARITIES, TYPES, WEEKDAYS, WEEKDAYS_LONG, HOURS,
  ymd, parseDay, presetRange, previousRange, bucketCount, formatRange,
  aggregate, change, fmt,
} from "../analytics.js";
import { breakdownTable, exportReport } from "../report-export.js";
import { exportDonors, formatDay } from "../donor-export.js";

const DEFAULTS = { preset: "last12", gran: "month", group: "", type: "", site: "", metric: "donations" };
const METRICS = {
  donations: { title: "Donations", per: "Donations per", value: (c) => c.donations, format: fmt.int },
  volume: { title: "Volume collected", per: "Litres collected per", value: (c) => Math.round(c.volumeL * 10) / 10, format: fmt.one },
  donors: { title: "Unique donors", per: "Unique donors per", value: (c) => c.donors, format: fmt.int },
};
const VIEWS = {
  overview: "Overview",
  analytics: "Analytics",
  donors: "Donor register",
  entry: "Record a visit",
  records: "Donation records",
  reports: "Reports & exports",
};
const TABS = ["groups", "donors", "sites", "timing"];
const PAGE_SIZE = 20;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (id) => document.getElementById(id);
const form = $("filters");
const alertEl = $("alert");

let meta = { sites: [], first: null, last: null };
let state = { ...DEFAULTS };
let view = null; // last rendered analytics, used by the exports
let chart = null;
let requestSeq = 0;
let route = { view: "overview", tab: "groups" };
let records = { status: "", page: 1, sorted: [] };

if (requireLogin("admin")) init();

/** Phosphor icon element. */
function ph(name, weight = "duotone") {
  return h("i", { class: `ph-${weight} ph-${name}`, "aria-hidden": "true" });
}

// ---------- Setup ----------

async function init() {
  bindLogout();
  bindShell();
  BLOOD_GROUPS.forEach((g) => form.elements.group.append(h("option", { value: g }, groupLabel(g))));

  try {
    meta = await get("/admin/donations/meta");
  } catch (err) {
    showAlert(alertEl, err.message);
  }
  (meta.sites || []).forEach((s) => form.elements.site.append(h("option", { value: s }, s)));
  if (meta.first) form.elements.from.min = form.elements.to.min = meta.first;
  form.elements.from.max = form.elements.to.max = ymd(new Date());

  readUrl();
  writeForm();
  bindEvents();
  bindTooltips();
  applyRoute();
  bindDonorSearch();
  bindEntry();
  window.addEventListener("hashchange", applyRoute);
  load();
}

// ---------- Shell: sidebar, routing, tabs, export menu ----------

function bindShell() {
  const sidebar = $("sidebar");
  const backdrop = document.querySelector(".sidebar-backdrop");
  const menuBtn = $("menu-btn");
  const desktop = window.matchMedia("(min-width: 1024px)");

  const open = () => {
    sidebar.classList.add("is-open");
    backdrop.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    sidebar.querySelector(".side-link[aria-current]")?.focus() || sidebar.querySelector("a")?.focus();
  };
  const close = (refocus = true) => {
    if (!sidebar.classList.contains("is-open")) return;
    sidebar.classList.remove("is-open");
    backdrop.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
    if (refocus) menuBtn.focus();
  };
  menuBtn.addEventListener("click", open);
  document.querySelectorAll("[data-sidebar-close]").forEach((el) => el.addEventListener("click", () => close()));
  sidebar.addEventListener("click", (e) => {
    if (e.target.closest("a[href^='#']") && !desktop.matches) close(false);
  });
  desktop.addEventListener("change", () => close(false));

  // Export menu
  const exportBtn = $("export-btn");
  const menu = $("export-menu");
  const setMenu = (show) => {
    menu.hidden = !show;
    exportBtn.setAttribute("aria-expanded", String(show));
    if (show) menu.querySelector("button")?.focus();
  };
  exportBtn.addEventListener("click", () => setMenu(menu.hidden));
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !e.target.closest(".menu")) setMenu(false);
  });
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length].focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length].focus();
    else return;
    e.preventDefault();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!menu.hidden) {
      setMenu(false);
      exportBtn.focus();
    } else close();
  });

  // Tabs: click + arrow keys (roving focus)
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      location.hash = `analytics/${tab.dataset.tab}`;
    });
    tab.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(tab);
      let next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      next.focus();
      next.click();
    });
  });
}

function parseHash() {
  const [v, t] = location.hash.replace(/^#/, "").split("/");
  return {
    view: v in VIEWS ? v : "overview",
    tab: TABS.includes(t) ? t : route.tab,
  };
}

function applyRoute() {
  const prevView = route.view;
  route = parseHash();

  document.querySelectorAll("[data-view]").forEach((el) => (el.hidden = el.dataset.view !== route.view));
  document.querySelectorAll("[data-view-link]").forEach((a) => {
    if (a.dataset.viewLink === route.view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  // The date filters and analytics export don't apply to data entry or the donor register.
  const noFilters = route.view === "donors" || route.view === "entry";
  form.hidden = noFilters;
  document.querySelector(".admin-header .menu").hidden = noFilters;
  $("entry-btn").hidden = route.view === "entry";
  if (route.view === "donors" && !donors.loaded) searchDonors("");
  if (route.view === "entry") openEntry();

  $("view-title").textContent = VIEWS[route.view];
  document.title = `${VIEWS[route.view]} · BloodLink admin`;

  document.querySelectorAll('[role="tab"]').forEach((tab) => {
    const on = tab.dataset.tab === route.tab;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    $(tab.getAttribute("aria-controls")).hidden = !on;
  });

  // Hidden canvases and segment labels need measuring once visible.
  requestAnimationFrame(() => {
    if (route.view === "overview") chart?.resize();
    if (route.view === "analytics" && route.tab === "donors") fitSegLabels();
  });
  if (prevView !== route.view) window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}

// ---------- Filters + URL state ----------

function readUrl() {
  const q = new URLSearchParams(location.search);
  const pick = (k, ok) => (q.has(k) && ok(q.get(k)) ? q.get(k) : state[k]);
  state.preset = pick("preset", (v) => [...form.elements.preset.options].some((o) => o.value === v));
  state.gran = pick("gran", (v) => v in GRANULARITIES);
  state.group = pick("group", (v) => BLOOD_GROUPS.includes(v));
  state.type = pick("type", (v) => v in TYPES);
  state.site = pick("site", (v) => (meta.sites || []).includes(v));
  state.metric = pick("metric", (v) => v in METRICS);

  if (state.preset === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(q.get("from")) && /^\d{4}-\d{2}-\d{2}$/.test(q.get("to"))) {
    state.from = q.get("from");
    state.to = q.get("to");
  } else {
    if (state.preset === "custom") state.preset = DEFAULTS.preset;
    applyPreset(state.preset, !q.has("gran"));
  }
}

function writeUrl() {
  const q = new URLSearchParams();
  q.set("preset", state.preset);
  q.set("gran", state.gran);
  if (state.preset === "custom") {
    q.set("from", state.from);
    q.set("to", state.to);
  }
  ["group", "type", "site"].forEach((k) => state[k] && q.set(k, state[k]));
  if (state.metric !== "donations") q.set("metric", state.metric);
  history.replaceState(null, "", `${location.pathname}?${q}${location.hash}`);
}

function applyPreset(preset, setGran = true) {
  const r = presetRange(preset, new Date(), meta.first);
  if (!r) return;
  state.from = ymd(r.from);
  state.to = ymd(r.to);
  if (setGran) state.gran = r.gran;
}

function writeForm() {
  const f = form.elements;
  f.preset.value = state.preset;
  f.from.value = state.from;
  f.to.value = state.to;
  f.group.value = state.group;
  f.type.value = state.type;
  f.site.value = state.site;
  syncGranularity();
  const metric = document.querySelector(`input[name="metric"][value="${state.metric}"]`);
  if (metric) metric.checked = true;
  renderChips();
}

// Disable groupings that would make an unreadable number of bars.
function syncGranularity() {
  const from = parseDay(state.from);
  const to = parseDay(state.to);
  const order = Object.keys(GRANULARITIES);
  const input = (g) => form.querySelector(`input[name="gran"][value="${g}"]`);
  order.forEach((g) => {
    const tooMany = bucketCount(from, to, g) > GRANULARITIES[g].maxBuckets;
    input(g).disabled = tooMany;
    input(g).nextElementSibling.title = tooMany ? `Too many ${GRANULARITIES[g].noun}s in this range. Pick a shorter period.` : "";
  });
  if (input(state.gran).disabled) {
    state.gran = order.slice(order.indexOf(state.gran)).find((g) => !input(g).disabled) || "year";
  }
  input(state.gran).checked = true;
}

// Active dimension filters as removable chips, and a count on the Filters button.
function renderChips() {
  const active = [
    state.group && { key: "group", label: `Blood group ${groupLabel(state.group)}` },
    state.type && { key: "type", label: TYPES[state.type] },
    state.site && { key: "site", label: state.site },
  ].filter(Boolean);
  const badge = $("filter-count");
  badge.hidden = !active.length;
  badge.textContent = active.length || "";
  $("chips").replaceChildren(
    ...active.map((c) =>
      h(
        "button",
        {
          type: "button",
          class: "chip",
          "aria-label": `Remove filter: ${c.label}`,
          onclick: () => {
            state[c.key] = "";
            writeForm();
            load();
          },
        },
        c.label,
        ph("x", "bold")
      )
    )
  );
}

function bindEvents() {
  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "preset") {
      if (t.value !== "custom") applyPreset(t.value);
      state.preset = t.value;
    } else if (t.name === "from" || t.name === "to") {
      state[t.name] = t.value;
      state.preset = "custom";
    } else if (t.name === "gran") {
      state.gran = t.value;
    } else if (t.name in state) {
      state[t.name] = t.value;
    } else return;
    writeForm();
    load();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  $("more-btn").addEventListener("click", (e) => {
    const panel = $("more-filters");
    panel.hidden = !panel.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) panel.querySelector("select").focus();
  });

  $("reset").addEventListener("click", () => {
    state = { ...DEFAULTS };
    applyPreset(state.preset);
    writeForm();
    load();
  });

  document.querySelectorAll('input[name="metric"]').forEach((input) =>
    input.addEventListener("change", () => {
      state.metric = input.value;
      writeUrl();
      if (view) renderTrend(view.agg);
    })
  );

  document.querySelectorAll('input[name="rstatus"]').forEach((input) =>
    input.addEventListener("change", () => {
      records.status = input.value;
      records.page = 1;
      renderRecords();
    })
  );

  document.querySelectorAll("[data-export]").forEach((btn) => btn.addEventListener("click", () => runExport(btn)));
}

// ---------- Data ----------

function validRange() {
  const err = $("range-error");
  err.textContent = "";
  form.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
  let msg = "";
  if (!state.from || !state.to) msg = "Choose both a start and an end date.";
  else if (state.from > state.to) msg = "The start date must be on or before the end date.";
  if (msg) {
    err.textContent = msg;
    form.elements.from.closest(".form-field").classList.add("has-error");
    form.elements.to.closest(".form-field").classList.add("has-error");
  }
  return !msg;
}

async function load() {
  if (!validRange()) return;
  writeUrl();
  clearAlert(alertEl);
  const seq = ++requestSeq;
  const board = $("board");
  board.classList.add("is-busy");
  board.setAttribute("aria-busy", "true");

  const from = parseDay(state.from);
  const to = parseDay(state.to);
  const prev = state.preset === "all" ? null : previousRange(from, to);
  const hasPrev = prev && (!meta.first || ymd(prev.from) >= meta.first);

  const q = new URLSearchParams({ from: ymd(hasPrev ? prev.from : from), to: ymd(to) });
  if (state.group) q.set("blood_group", state.group);
  if (state.type) q.set("type", state.type);
  if (state.site) q.set("site", state.site);

  try {
    const data = await get(`/admin/donations?${q}`);
    if (seq !== requestSeq) return; // a newer filter change won
    const list = Array.isArray(data) ? data : data?.donations || [];
    const agg = aggregate(list, from, to, state.gran);
    const prevAgg = hasPrev ? aggregate(list, prev.from, prev.to, state.gran) : null;
    render(agg, prevAgg);
  } catch (err) {
    if (seq !== requestSeq) return;
    showAlert(alertEl, err.message);
  } finally {
    if (seq === requestSeq) {
      board.classList.remove("is-busy");
      board.setAttribute("aria-busy", "false");
    }
  }
}

// ---------- Rendering ----------

function filtersText() {
  return [
    state.group ? `Blood group ${groupLabel(state.group)}` : "All blood groups",
    state.type ? TYPES[state.type] : "All donation types",
    state.site || "All sites",
  ].join(", ");
}

function render(agg, prevAgg) {
  const range = formatRange(agg.from, agg.to);
  const kpis = buildKpis(agg, prevAgg);
  const insights = buildInsights(agg, prevAgg);
  view = { agg, prevAgg, kpis, insights, range };

  renderKpis(kpis);
  renderTrend(agg);
  renderInsights(insights);

  renderBars($("groups"), agg.groups, (g) => h("span", { class: "group-chip" }, groupLabel(g.name)), (g) => `Blood group ${groupLabel(g.name)}`);
  renderMix(agg);
  renderDonorStats(agg);
  renderSites(agg);
  renderHeat(agg);

  records.sorted = [...agg.records].reverse(); // newest first
  records.page = 1;
  renderRecords();
  renderTable(agg);
}

// KPI tiles -----------------------------------------------------------

function deltaInfo(cur, prev, { lowerIsBetter = false, points = false } = {}) {
  if (prev == null) return null;
  let value;
  let label;
  if (points) {
    value = cur - prev;
    label = `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)} pts`;
  } else {
    value = change(cur, prev);
    if (value == null) return { label: "New this period", tone: "", dir: 0 };
    label = `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;
  }
  const dir = Math.abs(value) < 0.0005 ? 0 : value > 0 ? 1 : -1;
  const tone = dir === 0 ? "" : (dir > 0) !== lowerIsBetter ? "good" : "bad";
  return { label: dir === 0 ? "No change" : label, tone, dir };
}

function buildKpis(agg, prevAgg) {
  const t = agg.totals;
  const p = prevAgg?.totals;
  return [
    { label: "Donations", value: fmt.int(t.donations), raw: t.donations, delta: deltaInfo(t.donations, p?.donations) },
    { label: "Litres collected", value: fmt.one(t.volumeL), unit: "L", raw: Math.round(t.volumeL * 10) / 10, delta: deltaInfo(t.volumeL, p?.volumeL) },
    { label: "Unique donors", value: fmt.int(t.donors), raw: t.donors, delta: deltaInfo(t.donors, p?.donors) },
    { label: "Deferral rate", value: fmt.pct(t.deferralRate, 1), delta: deltaInfo(t.deferralRate, p?.deferralRate, { lowerIsBetter: true, points: true }) },
  ].map((k) => ({ ...k, change: k.delta ? `${k.delta.label} vs previous period` : "" }));
}

function renderKpis(kpis) {
  $("kpis").replaceChildren(
    ...kpis.map((k) =>
      h(
        "div",
        { class: "kpi" },
        h("span", { class: "kpi-label" }, k.label),
        h("span", { class: "kpi-value" }, k.value, k.unit ? h("small", {}, k.unit) : null),
        h(
          "span",
          { class: "kpi-delta", title: "Compared with the same number of days just before this period" },
          k.delta ? ph(k.delta.dir > 0 ? "arrow-up-right" : k.delta.dir < 0 ? "arrow-down-right" : "minus", "bold") : null,
          k.delta ? `${k.delta.label} vs previous period` : "No earlier period to compare"
        )
      )
    )
  );
}

// Trend chart -----------------------------------------------------------

const CHART_FONT = '"Host Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function trendConfig(agg, { forExport = false } = {}) {
  const m = METRICS[state.metric];
  const values = agg.buckets.map((b) => m.value(b.counts));
  const many = agg.buckets.length > 60;
  return {
    type: "bar",
    data: {
      labels: agg.buckets.map((b) => b.short),
      datasets: [
        {
          label: m.title,
          data: values,
          backgroundColor: "#c62828",
          hoverBackgroundColor: "#9f1f1f",
          borderRadius: many ? 2 : 4,
          borderSkipped: "start",
          maxBarThickness: 24,
          categoryPercentage: many ? 0.92 : 0.8,
          barPercentage: many ? 0.9 : 0.86,
        },
      ],
    },
    options: {
      responsive: !forExport,
      maintainAspectRatio: false,
      devicePixelRatio: forExport ? 2 : undefined,
      animation: forExport || reduceMotion ? false : { duration: 600, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      layout: { padding: forExport ? { top: 8, right: 16, bottom: 4, left: 4 } : 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: !forExport,
          backgroundColor: "#1e293b",
          titleFont: { family: CHART_FONT, weight: "700", size: 13 },
          bodyFont: { family: CHART_FONT, size: 12 },
          footerFont: { family: CHART_FONT, size: 11, weight: "400" },
          footerColor: "#cbd5e1",
          padding: 10,
          cornerRadius: 10,
          displayColors: false,
          callbacks: {
            title: (items) => {
              const b = agg.buckets[items[0].dataIndex];
              return b.long + (b.partial ? " (partial)" : "");
            },
            label: (item) => {
              const c = agg.buckets[item.dataIndex].counts;
              return [`${fmt.int(c.donations)} donations`, `${fmt.one(c.volumeL)} L collected`, `${fmt.int(c.donors)} unique donors`];
            },
            footer: (items) => {
              const c = agg.buckets[items[0].dataIndex].counts;
              return c.attempts ? `${fmt.pct(c.deferralRate, 1)} deferred` : "";
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: "#e2cbc6" },
          ticks: { color: "#566173", font: { family: CHART_FONT, size: forExport ? 13 : 12 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 14 },
        },
        y: {
          beginAtZero: true,
          grid: { color: "#f3e6e3" },
          border: { display: false },
          ticks: { color: "#566173", font: { family: CHART_FONT, size: forExport ? 13 : 12 }, precision: 0, maxTicksLimit: 6, callback: (v) => fmt.compact(v) },
        },
      },
    },
    plugins: forExport
      ? [{ id: "white-bg", beforeDraw: (c) => { const x = c.ctx; x.save(); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.restore(); } }]
      : [],
  };
}

function trendTitle(agg) {
  return `${METRICS[state.metric].per} ${GRANULARITIES[agg.gran].noun}`;
}

function renderTrend(agg) {
  const m = METRICS[state.metric];
  const values = agg.buckets.map((b) => m.value(b.counts));
  const peakIdx = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
  const total = state.metric === "donors" ? agg.totals.donors : state.metric === "volume" ? agg.totals.volumeL : agg.totals.donations;

  $("trend-title").textContent = trendTitle(agg);
  $("trend-sub").textContent = agg.buckets.length
    ? `${state.metric === "donors" ? "Unique in period" : "Total"} ${m.format(total)}${state.metric === "volume" ? " L" : ""} · peak ${agg.buckets[peakIdx].long} (${m.format(values[peakIdx])})`
    : "";
  const canvas = $("trend");
  canvas.setAttribute("aria-label", `${trendTitle(agg)}, ${agg.buckets.length} bars. Peak ${agg.buckets[peakIdx]?.long}: ${m.format(values[peakIdx] || 0)}. The full numbers are in the breakdown table on the Reports page.`);

  if (typeof window.Chart === "undefined") {
    canvas.parentElement.replaceChildren(emptyState("The chart library didn't load. Check your connection; the numbers are still on the Reports page."));
    return;
  }
  Chart.defaults.font.family = CHART_FONT;
  const cfg = trendConfig(agg);
  if (chart) {
    chart.data = cfg.data;
    chart.options = cfg.options;
    chart.update();
  } else {
    chart = new Chart(canvas, cfg);
  }
}

/** Render the trend chart off-screen at a fixed size for the exports. */
async function chartImage(agg) {
  if (typeof window.Chart === "undefined" || !agg.buckets.length) return null;
  const w = 1400;
  const hgt = 460;
  const holder = h("div", { style: `position:fixed;left:-99999px;top:0;width:${w}px;height:${hgt}px`, "aria-hidden": "true" });
  const canvas = h("canvas", { width: w, height: hgt });
  holder.append(canvas);
  document.body.append(holder);
  try {
    await document.fonts?.ready;
    const c = new Chart(canvas, trendConfig(agg, { forExport: true }));
    const url = c.toBase64Image("image/png", 1);
    c.destroy();
    return { url, w, h: hgt };
  } finally {
    holder.remove();
  }
}

// Highlights --------------------------------------------------------------

function buildInsights(agg, prevAgg) {
  const t = agg.totals;
  if (!t.donations) return [{ icon: "info", parts: ["No completed donations match these filters."] }];
  const out = [];
  const noun = GRANULARITIES[agg.gran].noun;

  if (prevAgg) {
    const c = change(t.donations, prevAgg.totals.donations);
    if (c != null) {
      out.push({
        icon: c >= 0 ? "trend-up" : "trend-down",
        parts: ["Donations are ", { b: `${c >= 0 ? "up" : "down"} ${fmt.pct(Math.abs(c), 1)}` }, ` on the previous period (${fmt.int(prevAgg.totals.donations)} → ${fmt.int(t.donations)}).`],
      });
    }
  }
  if (agg.buckets.length > 1) {
    const peak = agg.buckets.reduce((a, b) => (b.counts.donations > a.counts.donations ? b : a));
    out.push({ icon: "medal", parts: [`Busiest ${noun}: `, { b: peak.long }, ` with ${fmt.int(peak.counts.donations)} donations.`] });
  }
  if (agg.records.length > 20) {
    const wdMax = agg.weekday.indexOf(Math.max(...agg.weekday));
    const wdMin = agg.weekday.indexOf(Math.min(...agg.weekday));
    out.push({ icon: "calendar-dots", parts: [{ b: `${WEEKDAYS_LONG[wdMax]}s` }, ` bring in ${fmt.pct(agg.weekday[wdMax] / t.donations)} of donations; ${WEEKDAYS_LONG[wdMin]}s are quietest.`] });
    const hourTotals = HOURS.map((_, i) => agg.heat.reduce((s, row) => s + row[i], 0));
    const hi = hourTotals.indexOf(Math.max(...hourTotals));
    out.push({ icon: "clock", parts: ["Most donors arrive between ", { b: `${HOURS[hi]}:00 and ${HOURS[hi] + 1}:00` }, "."] });
  }
  const top = agg.groups[0];
  const oNeg = agg.groups.find((g) => g.name === "O-");
  out.push({
    icon: "drop",
    parts: state.group
      ? [{ b: groupLabel(state.group) }, ` donors gave ${fmt.int(top.count)} times in this period.`]
      : [{ b: groupLabel(top.name) }, ` is the most common group (${fmt.pct(top.share, 1)}). Universal-donor O− is ${fmt.pct(oNeg?.share || 0, 1)}.`],
  });
  if (agg.sites.length > 1) {
    out.push({ icon: "map-pin", parts: [{ b: agg.sites[0].name }, ` collected the most (${fmt.pct(agg.sites[0].share, 1)}).`] });
  }
  // Keep the four most useful: change, peak, top group, busiest weekday.
  return [out.find((i) => i.icon.startsWith("trend")), out.find((i) => i.icon === "medal"), out.find((i) => i.icon === "drop"), out.find((i) => i.icon === "calendar-dots")]
    .filter(Boolean);
}

const insightText = (i) => i.parts.map((p) => (typeof p === "string" ? p : p.b)).join("");

function renderInsights(list) {
  $("insights").replaceChildren(
    ...list.map((i) => h("li", {}, h("span", {}, ...i.parts.map((p) => (typeof p === "string" ? p : h("strong", {}, p.b))))))
  );
}

// Ranked bars ---------------------------------------------------------------

function renderBars(list, items, nameEl, tipTitle) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (!items.some((i) => i.count)) {
    list.replaceChildren(h("li", {}, emptyState("No donations to show.")));
    return;
  }
  list.replaceChildren(
    ...items.map((item) => {
      const li = h(
        "li",
        {
          class: "hbar",
          tabindex: "0",
          "data-tip-title": tipTitle(item),
          "data-tip": `${fmt.int(item.count)} donations · ${fmt.pct(item.share, 1)} of total`,
          "aria-label": `${tipTitle(item)}: ${fmt.int(item.count)} donations, ${fmt.pct(item.share, 1)}`,
        },
        nameEl(item),
        h("span", { class: "hbar-track", "aria-hidden": "true" }, h("span", { class: "hbar-fill" })),
        h("span", { class: "hbar-val", "aria-hidden": "true" }, fmt.int(item.count), h("span", {}, fmt.pct(item.share, 0)))
      );
      li.querySelector(".hbar-fill").style.setProperty("--w", `${(item.count / max) * 100}%`);
      return li;
    })
  );
}

// Mix (tall segmented bars) --------------------------------------------------

function renderMix(agg) {
  const box = $("mix");
  if (!agg.totals.donations) {
    box.replaceChildren(emptyState("No donations to show."));
    return;
  }
  const block = (title, parts) => {
    const bar = h(
      "div",
      { class: "segbar", role: "img", "aria-label": `${title}: ${parts.map((p) => `${p.name} ${fmt.pct(p.share, 1)}`).join(", ")}` },
      ...parts
        .map((p, i) => ({ ...p, slot: i + 1 }))
        .filter((p) => p.count > 0)
        .map((p) => {
          const seg = h(
            "span",
            { class: `s${p.slot}`, tabindex: "0", "data-tip-title": p.name, "data-tip": `${fmt.int(p.count)} donations · ${fmt.pct(p.share, 1)}`, "data-label": fmt.pct(p.share) },
            fmt.pct(p.share)
          );
          seg.style.flex = `${p.share} 1 0`;
          return seg;
        })
    );
    return h(
      "div",
      { class: "mix" },
      h("p", { class: "mix-title" }, title),
      bar,
      h("ul", { class: "legend" }, ...parts.map((p, i) => h("li", { class: `s${i + 1}` }, h("i"), p.name, " ", h("b", {}, fmt.int(p.count)))))
    );
  };
  box.replaceChildren(block("Donation type", agg.types), block("First-time vs returning", agg.donorMix));
  requestAnimationFrame(fitSegLabels);
}

// A label that doesn't fit its block is dropped (legend and tooltip still carry it).
function fitSegLabels() {
  document.querySelectorAll(".segbar > span").forEach((s) => {
    if (!s.clientWidth) return; // hidden tab: measure later
    s.textContent = s.dataset.label;
    if (s.scrollWidth > s.clientWidth + 1) s.textContent = "";
  });
}

function renderDonorStats(agg) {
  const t = agg.totals;
  const row = (label, value) => h("div", {}, h("dt", {}, label), h("dd", {}, value));
  $("donor-stats").replaceChildren(
    row("Donations per donor", t.donors ? (t.donations / t.donors).toFixed(2) : "—"),
    row("First-timers deferred", fmt.pct(agg.deferral.first, 1)),
    row("Returning donors deferred", fmt.pct(agg.deferral.returning, 1))
  );
}

// Sites table -----------------------------------------------------------------

function renderSites(agg) {
  const box = $("sites-table");
  if (!agg.siteDetails.length) {
    box.replaceChildren(emptyState("No donations to show."));
    return;
  }
  const max = Math.max(...agg.siteDetails.map((s) => s.share), 0.0001);
  box.replaceChildren(
    h(
      "table",
      { class: "table" },
      h("caption", { class: "visually-hidden" }, "Collection sites ranked by completed donations"),
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { scope: "col" }, "Site"),
          h("th", { scope: "col", class: "num" }, "Donations"),
          h("th", { scope: "col" }, "Share"),
          h("th", { scope: "col", class: "num" }, "Deferral rate")
        )
      ),
      h(
        "tbody",
        {},
        agg.siteDetails.map((s) => {
          const bar = h("span", { class: "share-bar", "aria-hidden": "true" }, h("span"));
          bar.firstChild.style.setProperty("--w", `${(s.share / max) * 100}%`);
          return h(
            "tr",
            {},
            h("th", { scope: "row" }, s.name),
            h("td", { class: "num" }, fmt.int(s.donations)),
            h("td", {}, h("span", { class: "share-cell" }, bar, h("b", {}, fmt.pct(s.share, 1)))),
            h("td", { class: "num" }, fmt.pct(s.deferralRate, 1))
          );
        })
      )
    )
  );
}

// Timing: heatmap + weekday/hour bars ------------------------------------------

function renderHeat(agg) {
  const grid = $("heat");
  const max = Math.max(1, ...agg.heat.flat());
  const cells = [h("span", { class: "hd" })];
  HOURS.forEach((hr) => cells.push(h("span", { class: "hd", title: `${hr}:00–${hr + 1}:00` }, hr < 12 ? `${hr}am` : hr === 12 ? "12pm" : `${hr - 12}pm`)));
  let peak = { v: -1 };
  agg.heat.forEach((row, d) => {
    cells.push(h("span", { class: "rl" }, WEEKDAYS[d]));
    row.forEach((v, i) => {
      if (v > peak.v) peak = { v, d, i };
      const cell = h("span", {
        class: "cell",
        tabindex: "0",
        "data-tip-title": `${WEEKDAYS_LONG[d]}, ${HOURS[i]}:00–${HOURS[i] + 1}:00`,
        "data-tip": `${fmt.int(v)} donations`,
        "aria-label": `${WEEKDAYS_LONG[d]} ${HOURS[i]}:00: ${v} donations`,
      });
      cell.style.setProperty("--p", (v / max).toFixed(3));
      cells.push(cell);
    });
  });
  grid.setAttribute("role", "img");
  grid.setAttribute(
    "aria-label",
    peak.v > 0 ? `Donations by weekday and hour. Busiest slot: ${WEEKDAYS_LONG[peak.d]} ${HOURS[peak.i]}:00 with ${peak.v} donations.` : "No donations in this period."
  );
  grid.replaceChildren(...cells);
}

// Records ------------------------------------------------------------------

function renderRecords() {
  const list = records.status ? records.sorted.filter((r) => r.status === records.status) : records.sorted;
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  records.page = Math.min(records.page, pages);
  const start = (records.page - 1) * PAGE_SIZE;
  const slice = list.slice(start, start + PAGE_SIZE);

  $("records-sub").textContent = `${fmt.int(list.length)} ${records.status || ""} visit${list.length === 1 ? "" : "s"}, newest first`.replace("  ", " ");

  const box = $("records-table");
  if (!slice.length) {
    box.replaceChildren(emptyState("No records match these filters."));
    $("pager").replaceChildren();
    return;
  }
  box.replaceChildren(
    h(
      "table",
      { class: "table" },
      h("caption", { class: "visually-hidden" }, "Donation records, newest first"),
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ["Date", "Blood group", "Type", "Site", "Status"].map((c) => h("th", { scope: "col" }, c))
        )
      ),
      h(
        "tbody",
        {},
        slice.map((r) => {
          const d = parseDay(r.donated_at);
          const done = r.status === "completed";
          return h(
            "tr",
            {},
            h("td", {}, `${formatRange(d, d)}, ${r.donated_at.slice(11, 16)}`),
            h("td", {}, h("span", { class: "group-chip" }, groupLabel(r.blood_group))),
            h("td", {}, TYPES[r.type] || r.type),
            h("td", {}, r.site),
            h("td", {}, h("span", { class: `badge badge-${r.status}` }, done ? "Completed" : "Deferred"))
          );
        })
      )
    )
  );

  const go = (p) => {
    records.page = p;
    renderRecords();
    $("records-table").scrollTop = 0;
  };
  $("pager").replaceChildren(
    h("span", {}, `Showing ${fmt.int(start + 1)}–${fmt.int(start + slice.length)} of ${fmt.int(list.length)}`),
    h(
      "div",
      { class: "pager-btns" },
      h("button", { type: "button", class: "btn btn-secondary", disabled: records.page <= 1, onclick: () => go(records.page - 1), "aria-label": "Previous page" }, ph("caret-left", "bold"), "Previous"),
      h("button", { type: "button", class: "btn btn-secondary", disabled: records.page >= pages, onclick: () => go(records.page + 1), "aria-label": "Next page" }, "Next", ph("caret-right", "bold"))
    )
  );
}

// Breakdown table (Reports) ------------------------------------------------------

function renderTable(agg) {
  const t = breakdownTable(agg);
  const noun = GRANULARITIES[agg.gran].noun;
  $("table-title").textContent = `Breakdown by ${noun}`;
  $("table-sub").textContent = "Exports also include a column for each blood group.";
  // On screen: Period, Donations, Volume, Donors, First-time, Deferral rate.
  const SHOW = [0, 1, 2, 3, 4, t.rateColumn];
  const cellText = (v, i) => (i === t.rateColumn ? fmt.pct(v, 1) : i === 2 ? fmt.one(v) : fmt.int(v));
  const head = SHOW.map((i) => h("th", { scope: "col", class: i ? "num" : null }, t.head[i]));
  const rows = t.rows.map((r) =>
    h(
      "tr",
      {},
      h("th", { scope: "row" }, r.label, r.partial ? h("span", { class: "tag-partial", title: "Only part of this period is inside the chosen dates" }, "partial") : null),
      ...SHOW.slice(1).map((i) => h("td", { class: "num" }, cellText(r.cells[i - 1], i)))
    )
  );
  const foot = h("tr", {}, ...SHOW.map((i) => h("td", { class: i ? "num" : null }, i ? cellText(t.foot[i], i) : t.foot[i])));
  $("table").replaceChildren(
    h(
      "table",
      { class: "table" },
      h("caption", { class: "visually-hidden" }, `Donations by ${noun}, ${formatRange(agg.from, agg.to)}`),
      h("thead", {}, h("tr", {}, head)),
      h("tbody", {}, rows),
      h("tfoot", {}, foot)
    )
  );
}

// Tooltip for the HTML charts -------------------------------------------------

function bindTooltips() {
  const tip = $("tip");
  let current = null;
  const show = (el, x, y) => {
    current = el;
    tip.replaceChildren(h("b", {}, el.dataset.tipTitle || ""), el.dataset.tip);
    tip.classList.add("is-on");
    const r = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
    const top = y - r.height - 12 < 8 ? y + 18 : y - r.height - 12;
    tip.style.transform = `translate(${left}px, ${top}px)`;
  };
  const hide = () => {
    current = null;
    tip.classList.remove("is-on");
  };
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el) show(el, e.clientX, e.clientY);
    else if (current) hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (!el) return hide();
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("scroll", hide, { passive: true });
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide());
}

// Export ---------------------------------------------------------------------

async function runExport(btn) {
  if (!view) return;
  const names = { pdf: "PDF", docx: "Word", xlsx: "Excel" };
  const kind = btn.dataset.export;
  const menu = $("export-menu");
  if (!menu.hidden) {
    menu.hidden = true;
    $("export-btn").setAttribute("aria-expanded", "false");
  }
  // Show progress on the button the user can see.
  const target = btn.closest(".menu") ? $("export-btn") : btn;
  const original = [...target.childNodes];
  clearAlert(alertEl);
  document.querySelectorAll("[data-export], #export-btn").forEach((b) => (b.disabled = true));
  target.setAttribute("aria-busy", "true");
  target.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), h("span", {}, `Preparing ${names[kind]}…`));
  try {
    const chartPng = kind === "xlsx" ? null : await chartImage(view.agg);
    const file = await exportReport(kind, {
      agg: view.agg,
      kpis: view.kpis.map((k) => ({ label: k.label, value: k.unit ? `${k.value} ${k.unit}` : k.value, raw: k.raw, change: k.change })),
      insights: view.insights.map(insightText),
      chartPng,
      chartTitle: trendTitle(view.agg),
      meta: { range: view.range, gran: GRANULARITIES[view.agg.gran].label, filters: filtersText() },
    });
    showAlert(alertEl, `Your ${names[kind]} report is downloading: ${file}`, "success");
  } catch (err) {
    console.error(err);
    showAlert(alertEl, err.message || `Couldn't create the ${names[kind]} file.`);
  } finally {
    target.replaceChildren(...original);
    target.removeAttribute("aria-busy");
    document.querySelectorAll("[data-export], #export-btn").forEach((b) => (b.disabled = false));
  }
}

// Donor register: search by Donor ID or name, export the results ------------

let donors = { loaded: false, query: "", list: [], total: 0, seq: 0 };

function bindDonorSearch() {
  const searchForm = $("donor-search");
  const input = $("donor-q");
  let timer = null;

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(timer);
    searchDonors(input.value);
  });
  // Live results while typing.
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => searchDonors(input.value), 250);
  });
  $("donor-clear").addEventListener("click", () => {
    input.value = "";
    searchDonors("");
    input.focus();
  });
  document.querySelectorAll("[data-donor-export]").forEach((btn) => btn.addEventListener("click", () => runDonorExport(btn)));
}

async function searchDonors(query) {
  const q = String(query || "").trim();
  const seq = ++donors.seq;
  const box = $("donors-table");
  box.setAttribute("aria-busy", "true");
  if (!donors.loaded) box.replaceChildren(emptyState("Loading donors…"));
  try {
    const res = await get(`/admin/donors?q=${encodeURIComponent(q)}`);
    if (seq !== donors.seq) return; // a newer search already started
    donors = { ...donors, loaded: true, query: q, list: res.results || [], total: res.total ?? (res.results || []).length };
    renderDonors();
  } catch (err) {
    if (seq !== donors.seq) return;
    box.replaceChildren(emptyState(err.message || "Couldn't load donors."));
  } finally {
    if (seq === donors.seq) box.removeAttribute("aria-busy");
  }
}

/** Wrap the matched part of a value in <mark>. */
function highlight(value, query) {
  const text = String(value ?? "");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  const lower = text.toLowerCase();
  const ranges = [];
  words.forEach((w) => {
    const i = lower.indexOf(w);
    if (i >= 0) ranges.push([i, i + w.length]);
  });
  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const out = [];
  let pos = 0;
  ranges.forEach(([a, b]) => {
    if (a < pos) return;
    out.push(text.slice(pos, a), h("mark", { class: "hit" }, text.slice(a, b)));
    pos = b;
  });
  out.push(text.slice(pos));
  return out;
}

function renderDonors() {
  const { list, query, total } = donors;
  $("donors-sub").textContent = query
    ? `${fmt.int(list.length)} of ${fmt.int(total)} donor${total === 1 ? "" : "s"} match “${query}”`
    : `All ${fmt.int(total)} registered donor${total === 1 ? "" : "s"}, by Donor ID`;
  document.querySelectorAll("[data-donor-export]").forEach((b) => (b.disabled = !list.length));

  const box = $("donors-table");
  if (!list.length) {
    box.replaceChildren(emptyState(query ? `No donor matches “${query}”. Check the Donor ID or spelling.` : "No donors have registered yet."));
    return;
  }
  box.replaceChildren(
    h(
      "table",
      { class: "table" },
      h("caption", { class: "visually-hidden" }, "Registered donors"),
      h("thead", {}, h("tr", {}, ["Donor ID", "Full name", "Phone", "Blood group", "Area / town", "Visits", "Last donation", "Registered", "Status"].map((c) => h("th", { scope: "col" }, c)))),
      h(
        "tbody",
        {},
        list.map((d) =>
          h(
            "tr",
            {},
            h("td", {}, h("span", { class: "donor-code" }, highlight(d.donor_code, query.toUpperCase().replace(/\s+/g, "")))),
            h("td", {}, highlight(d.name, query)),
            h("td", {}, h("a", { href: `tel:${String(d.phone).replace(/[^+\d]/g, "")}` }, d.phone)),
            h("td", {}, h("span", { class: "group-chip" }, groupLabel(d.blood_group))),
            h("td", {}, d.area || "—"),
            h("td", { class: "num" }, visitsLabel(d)),
            h("td", {}, d.last_donation_date ? formatDay(d.last_donation_date) : "Never"),
            h("td", {}, formatDay(d.registered_at)),
            h("td", {}, statusSelect(d))
          )
        )
      )
    )
  );
}

async function runDonorExport(btn) {
  if (!donors.list.length) return;
  const names = { pdf: "PDF", docx: "Word", xlsx: "Excel" };
  const kind = btn.dataset.donorExport;
  const original = [...btn.childNodes];
  const all = document.querySelectorAll("[data-donor-export]");
  clearAlert(alertEl);
  all.forEach((b) => (b.disabled = true));
  btn.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), h("span", {}, `Preparing ${names[kind]}…`));
  try {
    const file = await exportDonors(kind, donors.list, { query: donors.query });
    showAlert(alertEl, `Your ${names[kind]} file is downloading: ${file}`, "success");
  } catch (err) {
    console.error(err);
    showAlert(alertEl, err.message || `Couldn't create the ${names[kind]} file.`);
  } finally {
    btn.replaceChildren(...original);
    all.forEach((b) => (b.disabled = false));
  }
}

/** Visits column: visits recorded here, or a note if they gave before signing up. */
function visitsLabel(d) {
  const n = d.visits || 0;
  if (n) return String(n);
  return d.donated_before_signup ? "Before sign-up" : "0";
}

/** Eligible / Must wait dropdown in the donor register. */
function statusSelect(d) {
  const sel = h(
    "select",
    { class: `status-select ${d.eligible ? "is-eligible" : "is-wait"}`, "aria-label": `Status for ${d.name}` },
    h("option", { value: "eligible", selected: d.eligible }, "Eligible"),
    h("option", { value: "must_wait", selected: !d.eligible }, "Must wait")
  );
  sel.addEventListener("change", async () => {
    sel.disabled = true;
    clearAlert(alertEl);
    try {
      const updated = await patch(`/admin/donors/${encodeURIComponent(d.donor_code)}`, { status: sel.value });
      Object.assign(d, updated);
      sel.className = `status-select ${d.eligible ? "is-eligible" : "is-wait"}`;
      entry.donorsStale = true;
      showAlert(alertEl, `${d.name} (${d.donor_code}) is now marked “${d.eligible ? "Eligible" : "Must wait"}”.`, "success");
    } catch (err) {
      sel.value = d.eligible ? "eligible" : "must_wait";
      showAlert(alertEl, err.message);
    } finally {
      sel.disabled = false;
    }
  });
  return sel;
}

// Record a donor visit (data entry) -----------------------------------------

const VOLUME_L = { whole_blood: 0.45, plasma: 0.6, platelets: 0.25 };
const entry = { ready: false, donorsStale: false, donors: [], picked: null };

function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function bindEntry() {
  const f = $("entry-form");
  const el = f.elements;
  BLOOD_GROUPS.forEach((g) => el.blood_group.append(h("option", { value: g }, groupLabel(g))));
  (meta.sites || []).forEach((s) => el.site.append(h("option", { value: s }, s)));

  f.querySelectorAll('input[name="who"]').forEach((r) => r.addEventListener("change", toggleWho));
  el.donor_code.addEventListener("input", () => pickDonor(el.donor_code.value));
  el.donor_code.addEventListener("change", () => pickDonor(el.donor_code.value));
  el.type.addEventListener("change", () => {
    if (el.status.value === "completed" && el.volume_l.dataset.auto) el.volume_l.value = VOLUME_L[el.type.value];
  });
  el.volume_l.addEventListener("input", () => delete el.volume_l.dataset.auto);
  el.status.addEventListener("change", applyStatus);
  el.donor_kind.addEventListener("change", applyKind);
  el.visit_number.addEventListener("input", () => {
    el.donor_kind.value = Number(el.visit_number.value) > 1 ? "returning" : "first";
  });
  $("entry-reset").addEventListener("click", () => resetEntry(false));
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    saveEntry();
  });
  resetEntry(false);
}

function openEntry() {
  const f = $("entry-form");
  f.elements.donated_at.max = nowLocal();
  if (!entry.ready || entry.donorsStale) loadEntryDonors();
  if (!entry.ready) loadRecent();
  entry.ready = true;
}

async function loadEntryDonors() {
  try {
    const res = await get("/admin/donors?q=");
    entry.donors = res.results || [];
    entry.donorsStale = false;
    $("e-donor-list").replaceChildren(
      ...entry.donors.map((d) => h("option", { value: d.donor_code }, `${d.name} · ${groupLabel(d.blood_group)}`))
    );
    // Keep the picked donor's numbers fresh after a save.
    const f = $("entry-form");
    if (f.elements.donor_code.value) pickDonor(f.elements.donor_code.value, true);
  } catch (err) {
    showAlert(alertEl, err.message);
  }
}

function priorVisits(d) {
  return (d.visits || 0) + (d.donated_before_signup ? 1 : 0);
}

function pickDonor(value, quiet = false) {
  const f = $("entry-form");
  const el = f.elements;
  const v = String(value || "").trim();
  const code = v.toUpperCase().replace(/\s+/g, "");
  const byCode = entry.donors.find((d) => d.donor_code === code || d.donor_code === `DN${code.padStart(4, "0")}`);
  const byName = entry.donors.filter((d) => d.name.toLowerCase() === v.toLowerCase());
  const d = byCode || (byName.length === 1 ? byName[0] : null);
  const card = $("e-donor-card");
  entry.picked = d;

  if (!d) {
    card.hidden = true;
    el.blood_group.disabled = false;
    return;
  }
  if (!quiet && el.donor_code.value !== d.donor_code) el.donor_code.value = d.donor_code;
  const prior = priorVisits(d);
  card.replaceChildren(
    h("strong", {}, d.name),
    h("span", { class: "donor-code" }, d.donor_code),
    h("span", { class: "group-chip" }, groupLabel(d.blood_group)),
    h("span", { class: "muted" }, prior ? `${prior} earlier visit${prior === 1 ? "" : "s"}${d.donated_before_signup ? " (incl. before sign-up)" : ""}` : "No earlier visits: first-timer"),
    h("span", { class: `badge ${d.eligible ? "badge-eligible" : "badge-wait"}` }, d.eligible ? "Eligible" : "Must wait")
  );
  card.hidden = false;
  el.blood_group.value = d.blood_group;
  el.blood_group.disabled = true; // a registered donor's group is on file
  if (!quiet) {
    el.visit_number.value = prior + 1;
    el.donor_kind.value = prior ? "returning" : "first";
    applyKind();
  }
  f.querySelector('[data-error-for="donor_code"]').textContent = "";
  f.elements.donor_code.closest(".form-field").classList.remove("has-error");
}

function toggleWho() {
  const f = $("entry-form");
  const walkIn = f.querySelector('input[name="who"]:checked').value === "walkin";
  f.querySelectorAll("[data-who]").forEach((x) => (x.hidden = x.dataset.who !== (walkIn ? "walkin" : "registered")));
  $("e-donor-card").hidden = walkIn || !entry.picked;
  f.elements.blood_group.disabled = !walkIn && !!entry.picked;
  if (walkIn) {
    f.elements.blood_group.value = "";
    f.elements.donor_kind.value = "first";
    applyKind();
    f.elements.walk_in_name.focus();
  } else if (entry.picked) {
    pickDonor(entry.picked.donor_code);
  }
}

function applyStatus() {
  const el = $("entry-form").elements;
  const deferred = el.status.value === "deferred";
  el.volume_l.disabled = deferred;
  if (deferred) {
    el.volume_l.value = "";
  } else if (!el.volume_l.value) {
    el.volume_l.value = VOLUME_L[el.type.value];
    el.volume_l.dataset.auto = "1";
  }
  $("e-status-hint").textContent = deferred
    ? "No blood collected. The donor is marked “Must wait” until you change it in the Donors list."
    : "The donor then has to wait 90 days before giving again.";
}

function applyKind() {
  const el = $("entry-form").elements;
  if (el.donor_kind.value === "first") {
    el.visit_number.value = 1;
    el.visit_number.readOnly = true;
  } else {
    el.visit_number.readOnly = false;
    const suggested = entry.picked ? priorVisits(entry.picked) + 1 : 2;
    if (!(Number(el.visit_number.value) > 1)) el.visit_number.value = Math.max(2, suggested);
  }
}

function resetEntry(keepContext) {
  const f = $("entry-form");
  const el = f.elements;
  const keep = { site: el.site.value, type: el.type.value, when: el.donated_at.value };
  f.reset();
  clearFieldErrors(f);
  entry.picked = null;
  el.blood_group.disabled = false;
  $("e-donor-card").hidden = true;
  f.querySelectorAll("[data-who]").forEach((x) => (x.hidden = x.dataset.who !== "registered"));
  if (keepContext) {
    el.site.value = keep.site;
    el.type.value = keep.type;
  }
  el.donated_at.value = nowLocal();
  el.donated_at.max = nowLocal();
  el.volume_l.value = VOLUME_L[el.type.value];
  el.volume_l.dataset.auto = "1";
  el.donor_kind.value = "first";
  applyStatus();
  applyKind();
}

async function saveEntry() {
  const f = $("entry-form");
  const el = f.elements;
  clearAlert(alertEl);
  clearFieldErrors(f);
  const walkIn = f.querySelector('input[name="who"]:checked').value === "walkin";
  const completed = el.status.value === "completed";

  const errors = {};
  if (walkIn && !el.walk_in_name.value.trim()) errors.walk_in_name = "Enter the donor's name.";
  if (!walkIn && !el.donor_code.value.trim()) errors.donor_code = "Type the Donor ID or name, then pick from the list.";
  if (!el.blood_group.value) errors.blood_group = "Choose the blood group.";
  if (!el.donated_at.value) errors.donated_at = "Enter the date and time of the visit.";
  if (completed && !(Number(el.volume_l.value) > 0)) errors.volume_l = "Enter the litres collected.";
  if (!(Number(el.visit_number.value) >= 1)) errors.visit_number = "Enter the visit number (1 for a first-timer).";
  if (Object.keys(errors).length) {
    showFieldErrors(f, errors);
    return;
  }

  const payload = {
    walk_in: walkIn,
    donor_code: walkIn ? null : (entry.picked?.donor_code || el.donor_code.value.trim().toUpperCase()),
    walk_in_name: walkIn ? el.walk_in_name.value.trim() : null,
    blood_group: el.blood_group.value,
    donated_at: el.donated_at.value,
    site: el.site.value,
    type: el.type.value,
    status: el.status.value,
    volume_l: completed ? Number(el.volume_l.value) : 0,
    visit_number: Number(el.visit_number.value),
  };

  const submit = f.querySelector('[type="submit"]');
  setBusy(submit, true, "Saving…");
  try {
    const { visit } = await post("/admin/donations", payload);
    const day = visit.donated_at.slice(0, 10);
    const outside = day < state.from || day > state.to;
    showAlert(
      alertEl,
      `Saved: ${visit.donor_name} · ${visit.status === "completed" ? `${(visit.volume_ml / 1000).toFixed(2)} L collected` : "deferred (must wait)"} · ` +
        `${visit.first_time ? "first-time donor" : `visit ${visit.visit_number}`}. The Overview has been updated.` +
        (outside ? " Note: this date is outside the period selected on the Overview." : ""),
      "success"
    );
    resetEntry(true);
    donors.loaded = false; // donor register refreshes next time it opens
    await Promise.all([load(), loadRecent(visit.id), loadEntryDonors()]);
  } catch (err) {
    const matched = showFieldErrors(f, err.fields);
    showAlert(alertEl, matched ? "Please fix the highlighted fields." : err.message);
  } finally {
    setBusy(submit, false);
  }
}

function setBusy(btn, busy, text) {
  if (busy) {
    btn._label = [...btn.childNodes];
    btn.disabled = true;
    btn.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), text);
  } else {
    btn.disabled = false;
    if (btn._label) btn.replaceChildren(...btn._label);
  }
}

async function loadRecent(highlightId = null) {
  const box = $("entry-recent");
  try {
    const list = await get("/admin/donations/recent");
    if (!list.length) {
      box.replaceChildren(emptyState("Nothing recorded yet. Saved visits will appear here."));
      return;
    }
    box.replaceChildren(
      h(
        "table",
        { class: "table" },
        h("caption", { class: "visually-hidden" }, "Visits you recorded, newest first"),
        h("thead", {}, h("tr", {}, ["Date", "Donor", "Group", "Outcome", "Litres", "Visit", ""].map((c) => h("th", { scope: "col" }, c)))),
        h(
          "tbody",
          {},
          list.map((v) =>
            h(
              "tr",
              { class: v.id === highlightId ? "row-new" : null },
              h("td", {}, `${formatDay(v.donated_at.slice(0, 10))}, ${v.donated_at.slice(11, 16)}`),
              h("td", {}, h("div", {}, v.donor_name), v.donor_id.startsWith("DN") ? h("span", { class: "donor-code" }, v.donor_id) : h("span", { class: "muted" }, "Walk-in")),
              h("td", {}, h("span", { class: "group-chip" }, groupLabel(v.blood_group))),
              h("td", {}, h("span", { class: `badge badge-${v.status}` }, v.status === "completed" ? "Completed" : "Deferred")),
              h("td", { class: "num" }, v.volume_ml ? (v.volume_ml / 1000).toFixed(2) : "—"),
              h("td", { class: "num" }, v.first_time ? "1st" : `#${v.visit_number}`),
              h("td", {}, h("button", { type: "button", class: "row-remove", onclick: () => removeVisit(v) }, ph("trash", "bold"), "Remove"))
            )
          )
        )
      )
    );
  } catch (err) {
    box.replaceChildren(emptyState(err.message || "Couldn't load your entries."));
  }
}

async function removeVisit(v) {
  if (!confirm(`Remove the visit for ${v.donor_name} on ${formatDay(v.donated_at.slice(0, 10))}? The Overview will update.`)) return;
  clearAlert(alertEl);
  try {
    await del(`/admin/donations/${v.id}`);
    showAlert(alertEl, `Removed the visit for ${v.donor_name}. The Overview has been updated.`, "success");
    donors.loaded = false;
    await Promise.all([load(), loadRecent(), loadEntryDonors()]);
  } catch (err) {
    showAlert(alertEl, err.message);
  }
}
