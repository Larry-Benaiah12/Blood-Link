// Pure date + aggregation helpers for the admin analytics page.
// No DOM access here, so the same numbers feed the screen and the exports.

import { BLOOD_GROUPS } from "./constants.js";

export const GRANULARITIES = {
  day: { label: "Day", noun: "day", maxBuckets: 400 },
  week: { label: "Week", noun: "week", maxBuckets: 270 },
  month: { label: "Month", noun: "month", maxBuckets: Infinity },
  year: { label: "Year", noun: "year", maxBuckets: Infinity },
};

export const TYPES = {
  whole_blood: "Whole blood",
  plasma: "Plasma",
  platelets: "Platelets",
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ---------- Dates (all local, day precision) ----------

const pad = (n) => String(n).padStart(2, "0");

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(s) {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function daysBetween(a, b) {
  // inclusive count of calendar days from a to b
  return Math.round((parseDay(ymd(b)) - parseDay(ymd(a))) / 86400000) + 1;
}

function startOfWeek(d) {
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
}

export function bucketStart(d, gran) {
  if (gran === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (gran === "week") return startOfWeek(d);
  if (gran === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getFullYear(), 0, 1);
}

function nextBucket(d, gran) {
  if (gran === "day") return addDays(d, 1);
  if (gran === "week") return addDays(d, 7);
  if (gran === "month") return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return new Date(d.getFullYear() + 1, 0, 1);
}

export function bucketCount(from, to, gran) {
  let n = 0;
  for (let b = bucketStart(from, gran); b <= to; b = nextBucket(b, gran)) n++;
  return n;
}

export function formatDay(d, withYear = true) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? " " + d.getFullYear() : ""}`;
}

export function formatRange(from, to) {
  if (ymd(from) === ymd(to)) return formatDay(from);
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${formatDay(from, !sameYear)} – ${formatDay(to)}`;
}

function bucketLabels(start, gran, multiYear) {
  if (gran === "day") {
    return {
      short: formatDay(start, multiYear),
      long: `${WEEKDAYS[(start.getDay() + 6) % 7]} ${formatDay(start)}`,
    };
  }
  if (gran === "week") {
    return { short: formatDay(start, multiYear), long: `Week of ${formatDay(start)}` };
  }
  if (gran === "month") {
    return {
      short: multiYear ? `${MONTHS[start.getMonth()]} ${String(start.getFullYear()).slice(2)}` : MONTHS[start.getMonth()],
      long: `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`,
    };
  }
  return { short: String(start.getFullYear()), long: String(start.getFullYear()) };
}

/** Today's date and the preset ranges built from it. */
export function presetRange(preset, today = new Date(), firstDay = null) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const y = t.getFullYear();
  const m = t.getMonth();
  switch (preset) {
    case "last7": return { from: addDays(t, -6), to: t, gran: "day" };
    case "last30": return { from: addDays(t, -29), to: t, gran: "day" };
    case "last90": return { from: addDays(t, -89), to: t, gran: "week" };
    case "thisMonth": return { from: new Date(y, m, 1), to: t, gran: "day" };
    case "lastMonth": return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0), gran: "day" };
    case "last12": return { from: new Date(y, m - 11, 1), to: t, gran: "month" };
    case "thisYear": return { from: new Date(y, 0, 1), to: t, gran: "month" };
    case "lastYear": return { from: new Date(y - 1, 0, 1), to: new Date(y - 1, 11, 31), gran: "month" };
    case "all": return { from: firstDay ? parseDay(firstDay) : new Date(y - 3, 0, 1), to: t, gran: "year" };
    default: return null;
  }
}

/** The equally long period right before [from, to]. */
export function previousRange(from, to) {
  const len = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(len - 1)), to: prevTo };
}

// ---------- Aggregation ----------

function emptyCounts() {
  return { donations: 0, attempts: 0, deferred: 0, volumeMl: 0, firstTime: 0, donors: new Set(), groups: {} };
}

function add(c, r) {
  c.attempts++;
  if (r.status === "deferred") {
    c.deferred++;
    return;
  }
  c.donations++;
  c.volumeMl += r.volume_ml || 0;
  if (r.first_time) c.firstTime++;
  c.donors.add(r.donor_id);
  c.groups[r.blood_group] = (c.groups[r.blood_group] || 0) + 1;
}

function finish(c) {
  return {
    donations: c.donations,
    attempts: c.attempts,
    deferred: c.deferred,
    deferralRate: c.attempts ? c.deferred / c.attempts : 0,
    volumeL: c.volumeMl / 1000,
    donors: c.donors.size,
    firstTime: c.firstTime,
    groups: c.groups,
  };
}

/**
 * Summarise records that fall inside [from, to] (Date objects, inclusive days).
 * Records outside the range are ignored, so you can pass a wider list.
 */
export function aggregate(records, from, to, gran) {
  const fromKey = ymd(from);
  const toKey = ymd(to) + "T23:59:59";
  const multiYear = from.getFullYear() !== to.getFullYear();

  const buckets = [];
  const index = new Map();
  for (let b = bucketStart(from, gran); b <= to; b = nextBucket(b, gran)) {
    const end = addDays(nextBucket(b, gran), -1);
    const partial = b < from || end > to;
    const bucket = { key: ymd(b), start: b, end, partial, ...bucketLabels(b, gran, multiYear), counts: emptyCounts() };
    index.set(bucket.key, bucket);
    buckets.push(bucket);
  }

  const total = emptyCounts();
  const sites = {};
  const siteStats = {};
  const visits = { first: { attempts: 0, deferred: 0 }, returning: { attempts: 0, deferred: 0 } };
  const types = {};
  const weekday = Array(7).fill(0);
  const heat = WEEKDAYS.map(() => Array(HOURS.length).fill(0));
  let returning = 0;
  const inRange = [];

  for (const r of records) {
    if (r.donated_at < fromKey || r.donated_at > toKey) continue;
    inRange.push(r);
    const when = new Date(r.donated_at);
    add(total, r);
    const bucket = index.get(ymd(bucketStart(when, gran)));
    if (bucket) add(bucket.counts, r);
    const ss = (siteStats[r.site] ||= { attempts: 0, deferred: 0, donations: 0, volumeMl: 0, firstTime: 0 });
    ss.attempts++;
    const v = visits[r.first_time ? "first" : "returning"];
    v.attempts++;
    if (r.status !== "completed") {
      ss.deferred++;
      v.deferred++;
      continue;
    }
    ss.donations++;
    ss.volumeMl += r.volume_ml || 0;
    if (r.first_time) ss.firstTime++;
    sites[r.site] = (sites[r.site] || 0) + 1;
    types[r.type] = (types[r.type] || 0) + 1;
    if (!r.first_time) returning++;
    const wd = (when.getDay() + 6) % 7;
    weekday[wd]++;
    const hi = HOURS.indexOf(when.getHours());
    if (hi >= 0) heat[wd][hi]++;
  }

  const totals = finish(total);
  const rank = (obj) =>
    Object.entries(obj)
      .map(([name, count]) => ({ name, count, share: totals.donations ? count / totals.donations : 0 }))
      .sort((a, b) => b.count - a.count);

  return {
    from,
    to,
    gran,
    totals,
    buckets: buckets.map((b) => ({ ...b, counts: finish(b.counts) })),
    groups: BLOOD_GROUPS.map((g) => ({ name: g, count: totals.groups[g] || 0, share: totals.donations ? (totals.groups[g] || 0) / totals.donations : 0 })).sort(
      (a, b) => b.count - a.count
    ),
    sites: rank(sites),
    types: Object.keys(TYPES).map((k) => ({ key: k, name: TYPES[k], count: types[k] || 0, share: totals.donations ? (types[k] || 0) / totals.donations : 0 })),
    donorMix: [
      { key: "first", name: "First-time", count: totals.firstTime, share: totals.donations ? totals.firstTime / totals.donations : 0 },
      { key: "returning", name: "Returning", count: returning, share: totals.donations ? returning / totals.donations : 0 },
    ],
    siteDetails: Object.entries(siteStats)
      .map(([name, x]) => ({
        name,
        donations: x.donations,
        share: totals.donations ? x.donations / totals.donations : 0,
        volumeL: x.volumeMl / 1000,
        firstTime: x.firstTime,
        deferralRate: x.attempts ? x.deferred / x.attempts : 0,
      }))
      .sort((a, b) => b.donations - a.donations),
    deferral: {
      first: visits.first.attempts ? visits.first.deferred / visits.first.attempts : 0,
      returning: visits.returning.attempts ? visits.returning.deferred / visits.returning.attempts : 0,
    },
    weekday,
    heat,
    records: inRange,
  };
}

/** Relative change; null when there is nothing to compare against. */
export function change(current, previous) {
  if (previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

// ---------- Number formatting ----------

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const fmt = {
  int: (n) => nf0.format(Math.round(n)),
  one: (n) => nf1.format(n),
  pct: (p, digits = 0) => `${(p * 100).toFixed(digits)}%`,
  compact(n) {
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K";
    return nf0.format(n);
  },
};
