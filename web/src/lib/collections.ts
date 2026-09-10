// Single source of truth for Firestore collection names, so a typo
// doesn't silently create a sibling collection instead of erroring.
export const COLLECTIONS = {
  reservations: "reservations",
  dailySales: "dailySales",
  cashFlow: "cashFlow",
  greenFeeRates: "greenFeeRates",
  greenFeeApprovals: "greenFeeApprovals",
  weatherCache: "weatherCache",
  uploadLog: "uploadLog",
} as const;
