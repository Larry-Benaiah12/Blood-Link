// Deterministic demo donation history for the admin analytics page.
// Only used by js/mock.js. Records are generated on the fly (never stored in
// localStorage): roughly four years of donations with realistic patterns -
// growth year on year, a holiday dip, a June peak around World Blood Donor
// Day, busy Saturdays, quiet Sundays, and a morning rush.
//
// Shape of each record (this is also the contract for the real API):
// {
//   id: 1,
//   donated_at: "2026-11-07T09:40:00",   // local time, no zone
//   donor_id: 412,
//   blood_group: "O+",
//   type: "whole_blood" | "plasma" | "platelets",
//   volume_ml: 450,
//   site: "City General Hospital",
//   first_time: true,                    // donor's first ever donation
//   status: "completed" | "deferred",    // deferred = turned away at screening
// }

export const VOLUME_ML = { whole_blood: 450, plasma: 600, platelets: 250 };

export const SITES = [
  "City General Hospital",
  "Central Blood Bank",
  "Northside Clinic",
  "Mobile drive · University",
  "Mobile drive · Markets",
];

// Rough population share per group.
const GROUP_WEIGHTS = [
  ["O+", 0.42],
  ["A+", 0.24],
  ["B+", 0.2],
  ["AB+", 0.04],
  ["O-", 0.04],
  ["A-", 0.03],
  ["B-", 0.02],
  ["AB-", 0.01],
];
const TYPE_WEIGHTS = [
  ["whole_blood", 0.78],
  ["plasma", 0.15],
  ["platelets", 0.07],
];
const VOLUME = { whole_blood: 450, plasma: 600, platelets: 250 };
const SITE_WEIGHTS = [0.34, 0.28, 0.14, 0.14, 0.1];
// Mon..Sun multipliers (index 0 = Monday)
const WEEKDAY = [0.95, 0.9, 1.0, 1.0, 1.1, 1.45, 0.35];
// Hour of day 8..17
const HOURS = [0.7, 1.35, 1.5, 1.3, 1.0, 0.85, 1.05, 1.0, 0.8, 0.45];
// Jan..Dec
const MONTH = [0.82, 0.92, 1.0, 0.98, 1.02, 1.3, 1.08, 1.0, 1.04, 1.06, 1.0, 0.78];

function rng(seed) {
  // mulberry32
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rand, pairs) {
  let r = rand();
  for (const [value, w] of pairs) {
    if ((r -= w) <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

function pad(n) {
  return String(n).padStart(2, "0");
}

let cache = null;

/** All demo donations, oldest first. */
export function allDonations() {
  if (cache) return cache;
  const rand = rng(20240101);
  const now = new Date();
  const start = new Date(now.getFullYear() - 3, 0, 1);
  const hourPairs = HOURS.map((w, i) => [8 + i, w / HOURS.reduce((a, b) => a + b, 0)]);
  const sitePairs = SITES.map((s, i) => [s, SITE_WEIGHTS[i]]);

  const donors = []; // { id, group, count }
  const out = [];
  let id = 1;

  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const yearsIn = (d - start) / (365.25 * 86400000);
    const growth = 1 + yearsIn * 0.14;
    const weekday = (d.getDay() + 6) % 7;
    const wobble = 0.8 + rand() * 0.4;
    // June 14 drive week
    const drive = d.getMonth() === 5 && Math.abs(d.getDate() - 14) <= 3 ? 1.6 : 1;
    const expected = 13 * growth * WEEKDAY[weekday] * MONTH[d.getMonth()] * wobble * drive;
    const count = Math.max(0, Math.round(expected + (rand() - 0.5) * 4));

    const isToday = d.toDateString() === now.toDateString();
    for (let i = 0; i < count; i++) {
      const hour = pickWeighted(rand, hourPairs);
      const minute = Math.floor(rand() * 60);
      if (isToday && (hour > now.getHours() || (hour === now.getHours() && minute > now.getMinutes()))) continue;

      // ~70% of visits are returning donors once the pool has grown.
      let donor;
      let firstTime = false;
      if (donors.length > 40 && rand() < 0.7) {
        donor = donors[Math.floor(rand() * donors.length)];
      } else {
        donor = { id: donors.length + 1, group: pickWeighted(rand, GROUP_WEIGHTS) };
        donors.push(donor);
        firstTime = true;
      }

      const type = pickWeighted(rand, TYPE_WEIGHTS);
      // First-timers are deferred more often (low iron, recent travel, etc.).
      const deferred = rand() < (firstTime ? 0.13 : 0.05);

      out.push({
        id: id++,
        donated_at: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}:00`,
        donor_id: donor.id,
        blood_group: donor.group,
        type,
        volume_ml: deferred ? 0 : VOLUME[type],
        site: pickWeighted(rand, sitePairs),
        first_time: firstTime,
        status: deferred ? "deferred" : "completed",
      });
    }
  }
  out.sort((a, b) => (a.donated_at < b.donated_at ? -1 : 1));
  cache = out;
  return out;
}

/**
 * GET /admin/donations?from=YYYY-MM-DD&to=YYYY-MM-DD&blood_group=&type=&site=
 * `from` and `to` are inclusive calendar days.
 */
export function queryDonations(params, extra = []) {
  const from = params.get("from") || "0000-01-01";
  const to = (params.get("to") || "9999-12-31") + "T23:59:59";
  const group = params.get("blood_group");
  const type = params.get("type");
  const site = params.get("site");
  // `extra` = visits the admin recorded by hand (stored by mock.js).
  const all = extra.length ? [...allDonations(), ...extra].sort((a, b) => (a.donated_at < b.donated_at ? -1 : 1)) : allDonations();
  return all.filter(
    (r) =>
      r.donated_at >= from &&
      r.donated_at <= to &&
      (!group || r.blood_group === group) &&
      (!type || r.type === type) &&
      (!site || r.site === site)
  );
}

/** First and last day that have data, for the "All time" preset. */
export function donationBounds(extra = []) {
  const all = [...allDonations(), ...extra].sort((a, b) => (a.donated_at < b.donated_at ? -1 : 1));
  return { first: all[0]?.donated_at.slice(0, 10) ?? null, last: all[all.length - 1]?.donated_at.slice(0, 10) ?? null };
}
