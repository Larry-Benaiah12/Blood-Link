// Donor exports:
//  - exportDonors(): the admin's donor search results as Excel, Word or PDF.
//  - downloadSlip(): a donor's registration slip as a PDF they can take to a hospital.
// Uses the same lazily-loaded libraries as the analytics reports.

import { loadLibs, download } from "./report-export.js";

const RED = [198, 40, 40];
const DEEP = [122, 20, 20];
const INK = [30, 41, 59];
const MUTED = [86, 97, 115];
const CREAM = [250, 245, 239];

// Standard PDF fonts only cover Latin-1.
const pdfSafe = (s) => String(s ?? "").replace(/[−–—]/g, "-").replace(/·/g, "-").replace(/…/g, "...");

export function formatDay(value) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export const DONOR_COLUMNS = ["Donor ID", "Full name", "Phone", "Blood group", "Area / town", "Visits", "Last donation", "Registered", "Status"];

export function donorRow(d) {
  return [
    d.donor_code,
    d.name,
    d.phone,
    d.blood_group,
    d.area || "—",
    d.visits ? String(d.visits) : d.donated_before_signup ? "Before sign-up" : "0",
    d.last_donation_date ? formatDay(d.last_donation_date) : "Never / unknown",
    formatDay(d.registered_at),
    d.eligible ? "Eligible" : "Must wait",
  ];
}

function stamp() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return {
    file: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
    text: now.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
  };
}

// ---------------------------------------------------------------------------
// Admin: donor search results
// ---------------------------------------------------------------------------

/** kind: "pdf" | "docx" | "xlsx". donors: list from /admin/donors. Returns the file name. */
export async function exportDonors(kind, donors, { query = "" } = {}) {
  const t = stamp();
  const subtitle = query ? `Search: "${query}" · ${donors.length} donor${donors.length === 1 ? "" : "s"}` : `All donors · ${donors.length}`;
  const base = `bloodlink-donors_${t.file}`;
  const rows = donors.map(donorRow);

  if (kind === "xlsx") {
    await loadLibs("xlsx");
    const X = window.XLSX;
    const ws = X.utils.aoa_to_sheet([
      ["BloodLink · Donor register"],
      [subtitle],
      [`Generated ${t.text}`],
      [],
      DONOR_COLUMNS,
      ...rows,
    ]);
    ws["!cols"] = [10, 26, 18, 11, 24, 14, 16, 14, 12].map((wch) => ({ wch }));
    ws["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4 + rows.length, c: DONOR_COLUMNS.length - 1 } }) };
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Donors");
    X.writeFile(wb, `${base}.xlsx`, { compression: true });
    return `${base}.xlsx`;
  }

  if (kind === "pdf") {
    await loadLibs("pdf");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const W = doc.internal.pageSize.getWidth();
    const M = 14;
    doc.setFillColor(...DEEP);
    doc.rect(0, 0, W, 24, "F");
    doc.setFillColor(...RED);
    doc.rect(0, 24, W, 1.2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("BloodLink", M, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(255, 217, 217);
    doc.text("Donor register", M, 18.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text(pdfSafe(subtitle), W - M, 12, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(255, 217, 217);
    doc.text(pdfSafe(`Generated ${t.text}`), W - M, 18.5, { align: "right" });

    doc.autoTable({
      startY: 32,
      head: [DONOR_COLUMNS],
      body: rows.map((r) => r.map(pdfSafe)),
      margin: { left: M, right: M, bottom: 16 },
      styles: { font: "helvetica", fontSize: 9, cellPadding: 2.4, textColor: INK, lineColor: [235, 225, 222], lineWidth: 0.1 },
      headStyles: { fillColor: RED, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [255, 250, 249] },
      columnStyles: { 0: { fontStyle: "bold", textColor: DEEP } },
      didDrawPage: () => {
        const H = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text("BloodLink - Confidential: contains donor contact details", M, H - 8);
        doc.text(`Page ${doc.getNumberOfPages()}`, W - M, H - 8, { align: "right" });
      },
    });
    doc.save(`${base}.pdf`);
    return `${base}.pdf`;
  }

  if (kind === "docx") {
    await loadLibs("docx");
    const D = window.docx;
    const FONT = "Calibri";
    const text = (v, o = {}) => new D.TextRun({ text: String(v), font: FONT, size: o.size || 18, bold: o.bold, color: o.color });
    const none = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const borders = { top: none, left: none, right: none, bottom: { style: D.BorderStyle.SINGLE, size: 4, color: "EBE1DE" } };
    const cell = (v, o = {}) =>
      new D.TableCell({
        children: [new D.Paragraph({ children: [text(v, o)] })],
        shading: o.fill ? { fill: o.fill, type: D.ShadingType.CLEAR, color: "auto" } : undefined,
        borders,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
      });
    const table = new D.Table({
      width: { size: 100, type: D.WidthType.PERCENTAGE },
      rows: [
        new D.TableRow({ tableHeader: true, children: DONOR_COLUMNS.map((c) => cell(c, { bold: true, color: "FFFFFF", fill: "C62828" })) }),
        ...rows.map(
          (r, ri) =>
            new D.TableRow({
              children: r.map((v, i) => cell(v, { bold: i === 0, color: i === 0 ? "7A1414" : undefined, fill: ri % 2 ? "FFFAF9" : undefined })),
            })
        ),
      ],
    });
    const doc = new D.Document({
      creator: "BloodLink",
      title: "Donor register",
      sections: [
        {
          properties: { page: { size: { orientation: D.PageOrientation.LANDSCAPE }, margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
          footers: {
            default: new D.Footer({
              children: [
                new D.Paragraph({
                  children: [
                    text("BloodLink · Confidential: contains donor contact details · ", { size: 16, color: "566173" }),
                    new D.TextRun({ children: ["Page ", D.PageNumber.CURRENT, " of ", D.PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: "566173" }),
                  ],
                }),
              ],
            }),
          },
          children: [
            new D.Paragraph({ children: [text("BloodLink", { size: 36, bold: true, color: "C62828" })], spacing: { after: 40 } }),
            new D.Paragraph({ children: [text("Donor register", { size: 32, bold: true })], spacing: { after: 80 } }),
            new D.Paragraph({ children: [text(`${subtitle}   ·   Generated ${t.text}`, { color: "566173" })], spacing: { after: 240 } }),
            table,
          ],
        },
      ],
    });
    download(await D.Packer.toBlob(doc), `${base}.docx`);
    return `${base}.docx`;
  }

  throw new Error(`Unknown export format: ${kind}`);
}

// ---------------------------------------------------------------------------
// Donor: registration slip
// ---------------------------------------------------------------------------

/** The rows printed on the slip (also used for the on-screen copy). */
export function slipRows(r) {
  const location = r.place
    ? r.place
    : r.location_shared && r.lat != null
      ? `${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}`
      : "Not shared";
  return [
    ["Full name", r.name],
    ["Phone number", r.phone],
    ["Blood group", r.blood_group],
    ["Area / town", r.area || "—"],
    ["Location", location],
    ["Last donation", r.last_donation_date ? formatDay(r.last_donation_date) : "Never / don't remember"],
    ["Registered on", formatDay(r.registered_at)],
    ["Consent to be contacted", r.consent ? "Yes" : "No"],
  ];
}

export async function downloadSlip(r) {
  await loadLibs("pdf");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 18;

  // Header
  doc.setFillColor(...DEEP);
  doc.rect(0, 0, W, 34, "F");
  doc.setFillColor(...RED);
  doc.rect(0, 34, W, 1.5, "F");
  // Drop mark
  doc.setFillColor(255, 255, 255);
  doc.circle(M + 6, 19, 6, "F");
  doc.triangle(M + 0.9, 16.5, M + 11.1, 16.5, M + 6, 6.5, "F");
  doc.setFillColor(...RED);
  doc.rect(M + 5.1, 15.8, 1.8, 6.4, "F");
  doc.rect(M + 2.8, 18.1, 6.4, 1.8, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("BloodLink", M + 17, 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(255, 217, 217);
  doc.text("Emergency donor matching", M + 17, 23.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text("DONOR REGISTRATION SLIP", W - M, 17, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(255, 217, 217);
  doc.text("Present this slip at the hospital or blood bank", W - M, 23.5, { align: "right" });

  // Donor ID card
  let y = 48;
  doc.setFillColor(...CREAM);
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.6);
  doc.roundedRect(M, y, W - 2 * M, 34, 3, 3, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text("DONOR ID", M + 8, y + 11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(...DEEP);
  doc.text(pdfSafe(r.donor_code), M + 8, y + 26);

  // Blood group badge
  const bx = W - M - 38;
  doc.setFillColor(...RED);
  doc.roundedRect(bx, y + 6, 30, 22, 3, 3, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(255, 217, 217);
  doc.text("BLOOD GROUP", bx + 15, y + 12, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text(pdfSafe(r.blood_group), bx + 15, y + 23.5, { align: "center" });

  // Details
  y += 44;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text("Donor details", M, y);
  doc.autoTable({
    startY: y + 3,
    body: slipRows(r).map(([k, v]) => [k, pdfSafe(v)]),
    theme: "plain",
    margin: { left: M, right: M },
    styles: { font: "helvetica", fontSize: 11, cellPadding: { top: 3.2, bottom: 3.2, left: 3, right: 3 }, textColor: INK },
    columnStyles: { 0: { cellWidth: 58, textColor: MUTED }, 1: { fontStyle: "bold" } },
    didParseCell: (data) => {
      if (data.row.index % 2 === 0) data.cell.styles.fillColor = [255, 250, 249];
    },
  });

  // For hospital use
  y = doc.lastAutoTable.finalY + 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text("For hospital / blood bank use", M, y);
  doc.setDrawColor(200, 190, 188);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y + 4, W - 2 * M, 44, 2, 2, "S");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const line = (label, lx, ly, len) => {
    doc.text(label, lx, ly);
    doc.line(lx + doc.getTextWidth(label) + 2, ly + 0.5, lx + len, ly + 0.5);
  };
  const half = (W - 2 * M) / 2;
  line("Officer's name:", M + 6, y + 16, half - 10);
  line("Date:", M + half + 4, y + 16, half - 10);
  line("Screening result:", M + 6, y + 28, half - 10);
  line("Signature:", M + half + 4, y + 28, half - 10);
  doc.text("Stamp:", M + 6, y + 40);

  // Notes
  y += 60;
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const notes = [
    "Please bring a valid photo ID (Ghana Card, passport or voter ID) together with this slip.",
    "Final eligibility is always confirmed by the hospital or blood bank's own screening on the day.",
    "Wait at least 90 days between whole-blood donations. Feeling unwell? Simply skip a request.",
  ];
  notes.forEach((n, i) => doc.text(`•  ${n}`, M, y + i * 5.5));

  // Footer
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.4);
  doc.line(M, H - 16, W - M, H - 16);
  doc.setFontSize(8);
  doc.text(pdfSafe(`Generated ${stamp().text}  ·  Donor ID ${r.donor_code}`), M, H - 10);
  doc.text("BloodLink", W - M, H - 10, { align: "right" });

  const name = `BloodLink-donor-slip_${r.donor_code}.pdf`;
  doc.save(name);
  return name;
}
