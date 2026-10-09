/** Money is integer cents plus a currency code. Percentages of non-negative amounts round half up to a cent. */

export type Cents = number;

export function percentOf(cents: Cents, percent: number): Cents {
  return Math.round((cents * percent) / 100);
}

export function formatMoney(cents: Cents, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
