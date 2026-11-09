// Shared constants and labels.

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// Display label: a real minus sign so "A−" reads clearly.
export const groupLabel = (group) => String(group ?? "").replace("-", "−");

export const URGENCY = {
  critical: { label: "Critical", rank: 0 },
  urgent: { label: "Urgent", rank: 1 },
  normal: { label: "Normal", rank: 2 },
};

export const STATUS = {
  open: { label: "Open", rank: 0 },
  fulfilled: { label: "Fulfilled", rank: 1 },
  cancelled: { label: "Cancelled", rank: 2 },
};

// Region is free text on the backend and matched exactly, so always use this list.
export const REGIONS = [
  "Greater Accra", "Ashanti", "Western", "Western North", "Central", "Eastern",
  "Volta", "Oti", "Northern", "Savannah", "North East", "Upper East",
  "Upper West", "Bono", "Bono East", "Ahafo",
];

export const PHONE_RE = /^(0\d{9}|\+233\d{9})$/;
