// Build one report model from the current analytics view, then write it as
// PDF (jsPDF + AutoTable), Word (docx) or Excel (SheetJS).
// The libraries are only downloaded the first time someone exports.

import { BLOOD_GROUPS } from "./constants.js";
import { TYPES, WEEKDAYS_LONG, HOURS, fmt, ymd } from "./analytics.js";

const LIBS = {
  pdf: [
    ["jspdf", "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"],
    ["jspdf.plugin.autotable", "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"],
  ],
  docx: [["docx", "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js"]],
  xlsx: [["XLSX", "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"]],
};

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => {
          loaded.delete(src);
          s.remove();
          reject(new Error("Couldn't download the export tool. Check your internet connection and try again."));
        };
        document.head.append(s);
      })
    );
  }
  return loaded.get(src);
}
export async function loadLibs(kind) {
  for (const [, src] of LIBS[kind]) await loadScript(src); // in order: autotable needs jspdf
}

// ---------- Shared tables (also used on screen) ----------

/** Rows for the per-period breakdown table. */
export function breakdownTable(agg) {
  const head = ["Period", "Donations", "Volume (L)", "Donors", "First-time", "Deferred", "Deferral rate", ...BLOOD_GROUPS];
  const rows = agg.buckets.map((b) => {
    const c = b.counts;
    return {
      label: b.long,
      partial: b.partial,
      cells: [c.donations, round1(c.volumeL), c.donors, c.firstTime, c.deferred, c.deferralRate, ...BLOOD_GROUPS.map((g) => c.groups[g] || 0)],
    };
  });
  const t = agg.totals;
  const foot = ["Total", t.donations, round1(t.volumeL), t.donors, t.firstTime, t.deferred, t.deferralRate, ...BLOOD_GROUPS.map((g) => t.groups[g] || 0)];
  return { head, rows, foot, rateColumn: 6 };
}

const round1 = (n) => Math.round(n * 10) / 10;

function asText(value, col, rateColumn) {
  if (col === rateColumn) return fmt.pct(value, 1);
  if (col === 2) return fmt.one(value);
  return typeof value === "number" ? fmt.int(value) : String(value);
}

// ---------- Report model ----------

/**
 * view: { agg, kpis: [{label, value, change}], meta: {range, gran, filters}, chartPng }
 */
function model(view) {
  const { agg } = view;
  const table = breakdownTable(agg);
  const generated = new Date();
  return {
    title: "Donation report",
    range: view.meta.range,
    meta: [
      ["Period", view.meta.range],
      ["Grouped by", view.meta.gran],
      ["Filters", view.meta.filters],
      ["Generated", generated.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
    ],
    kpis: view.kpis,
    chartPng: view.chartPng,
    insights: view.insights || [],
    breakdown: {
      head: table.head,
      rows: table.rows.map((r) => [r.label + (r.partial ? " (partial)" : ""), ...r.cells.map((v, i) => asText(v, i + 1, table.rateColumn))]),
      foot: table.foot.map((v, i) => asText(v, i, table.rateColumn)),
      raw: table,
    },
    groups: agg.groups.map((g) => [g.name, fmt.int(g.count), fmt.pct(g.share, 1)]),
    sites: agg.sites.map((s) => [s.name, fmt.int(s.count), fmt.pct(s.share, 1)]),
    types: agg.types.map((t) => [t.name, fmt.int(t.count), fmt.pct(t.share, 1)]),
    fileBase: `bloodlink-donations_${ymd(agg.from)}_to_${ymd(agg.to)}_by-${agg.gran}`,
    agg,
  };
}

// ---------- PDF ----------

// Standard PDF fonts only cover Latin-1; swap the few typographic marks we use.
const pdfSafe = (s) => String(s).replace(/[−–—]/g, "-").replace(/·/g, "-").replace(/…/g, "...");

async function toPdf(m) {
  await loadLibs("pdf");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const RED = [198, 40, 40];
  const DEEP = [122, 20, 20];
  const INK = [30, 41, 59];
  const MUTED = [86, 97, 115];
  const CREAM = [250, 245, 239];

  // Header band
  doc.setFillColor(...DEEP);
  doc.rect(0, 0, W, 26, "F");
  doc.setFillColor(...RED);
  doc.rect(0, 26, W, 1.2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("BloodLink", M, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(255, 217, 217);
  doc.text("Donation analytics", M, 19.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(pdfSafe(`${m.title}: ${m.range}`), W - M, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(255, 217, 217);
  doc.text(pdfSafe(m.meta.slice(1).map(([k, v]) => `${k}: ${v}`).join("   |   ")), W - M, 19.5, { align: "right" });

  // KPI tiles
  let y = 34;
  const gap = 4;
  const n = m.kpis.length;
  const tileW = (W - 2 * M - gap * (n - 1)) / n;
  m.kpis.forEach((k, i) => {
    const x = M + i * (tileW + gap);
    const hero = i === 0;
    doc.setFillColor(...(hero ? RED : CREAM));
    doc.roundedRect(x, y, tileW, 24, 3, 3, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...(hero ? [255, 217, 217] : MUTED));
    doc.text(pdfSafe(k.label), x + 4, y + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...(hero ? [255, 255, 255] : INK));
    doc.text(pdfSafe(k.value), x + 4, y + 14.5);
    if (k.change) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...(hero ? [255, 255, 255] : MUTED));
      doc.text(pdfSafe(k.change), x + 4, y + 20.5);
    }
  });
  y += 32;

  // Chart
  if (m.chartPng) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(pdfSafe(m.chartTitle || "Donations over time"), M, y);
    const imgW = W - 2 * M;
    const imgH = imgW * (m.chartPng.h / m.chartPng.w);
    doc.addImage(m.chartPng.url, "PNG", M, y + 3, imgW, imgH, undefined, "FAST");
    y += imgH + 10;
  }

  // Highlights
  if (m.insights.length && y < H - 40) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text("Highlights", M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    m.insights.forEach((t, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      doc.setFillColor(...RED);
      doc.circle(M + col * ((W - 2 * M) / 2) + 1, y + 5.2 + row * 6 - 1, 0.9, "F");
      doc.text(pdfSafe(t), M + 4 + col * ((W - 2 * M) / 2), y + 5.2 + row * 6);
    });
  }

  const tableStyle = {
    theme: "plain",
    styles: { font: "helvetica", fontSize: 8, textColor: INK, cellPadding: { top: 1.8, bottom: 1.8, left: 2.5, right: 2.5 }, lineColor: [243, 230, 227], lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: RED, textColor: [255, 255, 255], fontStyle: "bold" },
    footStyles: { fillColor: CREAM, textColor: INK, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [255, 250, 249] },
    margin: { left: M, right: M, top: 20 },
  };
  const sectionTitle = (text, at) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(pdfSafe(text), M, at);
  };

  // Breakdown table on a new page
  doc.addPage();
  sectionTitle(`Breakdown by ${m.agg.gran}`, 18);
  doc.autoTable({
    ...tableStyle,
    startY: 22,
    head: [m.breakdown.head.map(pdfSafe)],
    body: m.breakdown.rows.map((r) => r.map(pdfSafe)),
    foot: [m.breakdown.foot.map(pdfSafe)],
    showFoot: "lastPage",
    columnStyles: Object.fromEntries(m.breakdown.head.map((_, i) => [i, { halign: i === 0 ? "left" : "right" }])),
    didParseCell: (d) => {
      if (d.column.index > 0) d.cell.styles.halign = "right";
    },
  });

  // Distribution tables, three side by side
  let after = doc.lastAutoTable.finalY + 12;
  if (after > H - 60) {
    doc.addPage();
    after = 18;
  }
  const colW = (W - 2 * M - 2 * 8) / 3;
  [
    ["By blood group", m.groups, "Blood group"],
    ["By collection site", m.sites, "Site"],
    ["By donation type", m.types, "Type"],
  ].forEach(([title, body, first], i) => {
    const left = M + i * (colW + 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(title, left, after);
    doc.autoTable({
      ...tableStyle,
      startY: after + 3,
      margin: { left, right: W - left - colW },
      tableWidth: colW,
      head: [[first, "Donations", "Share"]],
      body: body.map((r) => r.map(pdfSafe)),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
      didParseCell: (d) => {
        if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = "right";
      },
    });
  });

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("BloodLink - Confidential. Contains no donor names or phone numbers.", M, H - 7);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 7, { align: "right" });
  }

  doc.save(`${m.fileBase}.pdf`);
}

// ---------- Word (.docx) ----------

function dataUrlToBytes(url) {
  const bin = atob(url.split(",")[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function toDocx(m) {
  await loadLibs("docx");
  const D = window.docx;
  const FONT = "Calibri";
  const RED = "C62828";
  const INK = "1E293B";
  const MUTED = "566173";
  const CREAM = "FAF5EF";
  const BORDER = "ECDCD8";

  const text = (t, o = {}) => new D.TextRun({ text: String(t), font: FONT, size: o.size || 20, bold: o.bold, color: o.color || INK });
  const para = (t, o = {}) =>
    new D.Paragraph({ children: Array.isArray(t) ? t : [text(t, o)], spacing: { after: o.after ?? 120, before: o.before ?? 0 }, alignment: o.align });
  const heading = (t) => para(t, { size: 28, bold: true, before: 240, after: 120 });

  const thinBorders = {
    top: { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: D.BorderStyle.SINGLE, size: 4, color: BORDER },
  };
  const cell = (value, o = {}) =>
    new D.TableCell({
      children: [
        new D.Paragraph({
          alignment: o.right ? D.AlignmentType.RIGHT : D.AlignmentType.LEFT,
          children: [text(value, { size: o.size || 16, bold: o.bold, color: o.color })],
        }),
      ],
      shading: o.fill ? { fill: o.fill, type: D.ShadingType.CLEAR, color: "auto" } : undefined,
      borders: thinBorders,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    });
  const table = (head, body, foot, size = 16) =>
    new D.Table({
      width: { size: 100, type: D.WidthType.PERCENTAGE },
      rows: [
        new D.TableRow({ tableHeader: true, children: head.map((v, i) => cell(v, { bold: true, color: "FFFFFF", fill: RED, right: i > 0, size })) }),
        ...body.map((r, ri) => new D.TableRow({ children: r.map((v, i) => cell(v, { right: i > 0, size, fill: ri % 2 ? "FFFAF9" : undefined })) })),
        ...(foot ? [new D.TableRow({ children: foot.map((v, i) => cell(v, { bold: true, right: i > 0, size, fill: CREAM })) })] : []),
      ],
    });

  const kpiTable = new D.Table({
    width: { size: 100, type: D.WidthType.PERCENTAGE },
    rows: [
      new D.TableRow({
        children: m.kpis.map(
          (k, i) =>
            new D.TableCell({
              shading: { fill: i === 0 ? RED : CREAM, type: D.ShadingType.CLEAR, color: "auto" },
              borders: { top: thinBorders.top, left: { style: D.BorderStyle.SINGLE, size: 12, color: "FFFFFF" }, right: { style: D.BorderStyle.SINGLE, size: 12, color: "FFFFFF" }, bottom: thinBorders.top },
              margins: { top: 120, bottom: 120, left: 140, right: 140 },
              children: [
                para(k.label, { size: 16, color: i === 0 ? "FFD9D9" : MUTED, after: 40 }),
                para(k.value, { size: 30, bold: true, color: i === 0 ? "FFFFFF" : INK, after: 40 }),
                ...(k.change ? [para(k.change, { size: 15, color: i === 0 ? "FFFFFF" : MUTED, after: 0 })] : []),
              ],
            })
        ),
      }),
    ],
  });

  const children = [
    para([text("BloodLink", { size: 36, bold: true, color: RED })], { after: 40 }),
    para(`${m.title}: ${m.range}`, { size: 32, bold: true, after: 80 }),
    para(m.meta.slice(1).map(([k, v]) => `${k}: ${v}`).join("   ·   "), { size: 18, color: MUTED, after: 240 }),
    kpiTable,
  ];

  if (m.chartPng) {
    const widthPx = 900;
    children.push(
      heading(m.chartTitle || "Donations over time"),
      new D.Paragraph({
        children: [new D.ImageRun({ data: dataUrlToBytes(m.chartPng.url), transformation: { width: widthPx, height: Math.round(widthPx * (m.chartPng.h / m.chartPng.w)) } })],
      })
    );
  }

  if (m.insights.length) {
    children.push(heading("Highlights"), ...m.insights.map((t) => new D.Paragraph({ bullet: { level: 0 }, children: [text(t)], spacing: { after: 60 } })));
  }

  children.push(
    new D.Paragraph({ children: [new D.PageBreak()] }),
    heading(`Breakdown by ${m.agg.gran}`),
    table(m.breakdown.head, m.breakdown.rows, m.breakdown.foot, 15),
    heading("By blood group"),
    table(["Blood group", "Donations", "Share"], m.groups, null, 18),
    heading("By collection site"),
    table(["Site", "Donations", "Share"], m.sites, null, 18),
    heading("By donation type"),
    table(["Type", "Donations", "Share"], m.types, null, 18)
  );

  const doc = new D.Document({
    creator: "BloodLink",
    title: `${m.title}: ${m.range}`,
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [
      {
        properties: { page: { size: { orientation: D.PageOrientation.LANDSCAPE }, margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
        footers: {
          default: new D.Footer({
            children: [
              new D.Paragraph({
                children: [
                  new D.TextRun({ text: "BloodLink · Confidential · ", font: FONT, size: 16, color: MUTED }),
                  new D.TextRun({ children: ["Page ", D.PageNumber.CURRENT, " of ", D.PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const blob = await D.Packer.toBlob(doc);
  download(blob, `${m.fileBase}.docx`);
}

// ---------- Excel (.xlsx) ----------

async function toXlsx(m) {
  await loadLibs("xlsx");
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const t = m.agg.totals;
  const raw = m.breakdown.raw;

  const sheet = (rows, widths, name) => {
    const ws = X.utils.aoa_to_sheet(rows);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    X.utils.book_append_sheet(wb, ws, name);
    return ws;
  };

  sheet(
    [
      ["BloodLink · " + m.title],
      [],
      ...m.meta,
      [],
      ["Measure", "Value", "Change vs previous period"],
      ...m.kpis.map((k) => [k.label, k.raw ?? k.value, k.change || ""]),
      [],
      ["Totals"],
      ["Completed donations", t.donations],
      ["Donor visits (incl. deferred)", t.attempts],
      ["Deferred at screening", t.deferred],
      ["Deferral rate", `${(t.deferralRate * 100).toFixed(1)}%`],
      ["Volume collected (L)", round1(t.volumeL)],
      ["Unique donors", t.donors],
      ["First-time donations", t.firstTime],
      [],
      ["Highlights"],
      ...m.insights.map((s) => [s]),
    ],
    [30, 34, 28],
    "Summary"
  );

  const bd = sheet(
    [raw.head, ...raw.rows.map((r) => [r.label + (r.partial ? " (partial)" : ""), ...r.cells]), raw.foot],
    [24, 11, 11, 9, 11, 10, 13, ...BLOOD_GROUPS.map(() => 7)],
    "Breakdown"
  );
  // Format the deferral-rate column as a percentage.
  const range = X.utils.decode_range(bd["!ref"]);
  for (let r = 1; r <= range.e.r; r++) {
    const c = bd[X.utils.encode_cell({ r, c: raw.rateColumn })];
    if (c && typeof c.v === "number") c.z = "0.0%";
  }

  const share = (list) => list.map((x) => [x.name, x.count, Math.round(x.share * 1000) / 1000]);
  const pctCol = (ws) => {
    const rg = X.utils.decode_range(ws["!ref"]);
    for (let r = 1; r <= rg.e.r; r++) {
      const c = ws[X.utils.encode_cell({ r, c: 2 })];
      if (c && typeof c.v === "number") c.z = "0.0%";
    }
  };
  pctCol(sheet([["Blood group", "Donations", "Share"], ...share(m.agg.groups)], [14, 12, 10], "Blood groups"));
  pctCol(sheet([["Site", "Donations", "Share"], ...share(m.agg.sites)], [28, 12, 10], "Sites"));
  pctCol(sheet([["Type", "Donations", "Share"], ...share(m.agg.types)], [16, 12, 10], "Donation types"));
  sheet(
    [["Weekday", ...HOURS.map((h) => `${h}:00`)], ...m.agg.heat.map((row, i) => [WEEKDAYS_LONG[i], ...row])],
    [12, ...HOURS.map(() => 7)],
    "Weekday x hour"
  );
  sheet(
    [
      ["ID", "Date", "Time", "Blood group", "Type", "Volume (ml)", "Site", "First-time", "Status", "Donor ref"],
      ...m.agg.records.map((r) => [
        r.id,
        r.donated_at.slice(0, 10),
        r.donated_at.slice(11, 16),
        r.blood_group,
        TYPES[r.type] || r.type,
        r.volume_ml,
        r.site,
        r.first_time ? "Yes" : "No",
        r.status === "completed" ? "Completed" : "Deferred",
        r.donor_id,
      ]),
    ],
    [8, 11, 7, 11, 12, 11, 26, 10, 11, 10],
    "Records"
  );

  X.writeFile(wb, `${m.fileBase}.xlsx`, { compression: true });
}

// ---------- Entry point ----------

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportReport(kind, view) {
  const m = model(view);
  m.chartTitle = view.chartTitle;
  if (kind === "pdf") await toPdf(m);
  else if (kind === "docx") await toDocx(m);
  else if (kind === "xlsx") await toXlsx(m);
  else throw new Error(`Unknown export format: ${kind}`);
  return `${m.fileBase}.${kind}`;
}
