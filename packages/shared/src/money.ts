/**
 * Money is integer paise everywhere. No float, no rounding drift, and §11's
 * "every money calculation has a unit test with a worked example" becomes an
 * exact-equality assertion instead of a tolerance check.
 */
export type Paise = number

export const rupeesToPaise = (rupees: number): Paise => Math.round(rupees * 100)
export const paiseToRupees = (paise: Paise): number => paise / 100

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
})

/** Format at the edge only — never store a formatted string. */
export const formatPaise = (paise: Paise): string => INR.format(paiseToRupees(paise))
