/** Converts a database numeric string or validated number to integer cents. */
export function moneyToCents(value: string | number): number {
  const source = typeof value === "number" ? value.toFixed(2) : value;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(source);

  if (!match) {
    throw new Error("Expected a non-negative monetary value with at most two decimal places.");
  }

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return whole * 100 + fraction;
}

export function centsToMoney(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("Expected a non-negative integer number of cents.");
  }

  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Money in both integer cents (for arithmetic) and a decimal string (for display). */
export interface MoneyAmount {
  cents: number;
  amount: string;
}

export function toMoneyAmount(cents: number): MoneyAmount {
  return { cents, amount: centsToMoney(cents) };
}

export function calculateOrderTotal(
  selections: ReadonlyArray<{ quantity: number; unitPrice: string | number }>
): { cents: number; amount: string } {
  const cents = selections.reduce((total, selection) => {
    if (!Number.isInteger(selection.quantity) || selection.quantity <= 0) {
      throw new Error("Order item quantities must be positive integers.");
    }

    return total + moneyToCents(selection.unitPrice) * selection.quantity;
  }, 0);

  return { cents, amount: centsToMoney(cents) };
}
