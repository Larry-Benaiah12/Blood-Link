// Shared constants and labels.

// Values sent to / received from the API use ASCII "-".
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// Display label: use a real minus sign so "A−" reads clearly.
export function groupLabel(group) {
  return String(group ?? "").replace("-", "−");
}

export const URGENCY = {
  critical: { label: "Critical", rank: 0 },
  high: { label: "High", rank: 1 },
  normal: { label: "Normal", rank: 2 },
};

export const STATUS = {
  open: { label: "Open", rank: 0 },
  fulfilled: { label: "Fulfilled", rank: 1 },
  cancelled: { label: "Cancelled", rank: 2 },
};

// Which donor groups can give to each recipient group (red cells).
export const COMPATIBLE_DONORS = {
  "O-": ["O-"],
  "O+": ["O-", "O+"],
  "A-": ["O-", "A-"],
  "A+": ["O-", "O+", "A-", "A+"],
  "B-": ["O-", "B-"],
  "B+": ["O-", "O+", "B-", "B+"],
  "AB-": ["O-", "A-", "B-", "AB-"],
  "AB+": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
};

// Donors are eligible again this many days after their last donation.
export const DONATION_GAP_DAYS = 90;

// Donor IDs are sequential: DN0001, DN0002, … (more digits after DN9999).
export function donorCode(id) {
  return `DN${String(id).padStart(4, "0")}`;
}
