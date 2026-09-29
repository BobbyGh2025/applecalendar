/**
 * Phase 5C: Centralized Money Utilities
 *
 * All monetary values in the system are stored as INTEGER MINOR UNITS.
 *
 * Examples (2-decimal currencies like GHS, USD):
 *   GHS 100.00 → 10000
 *   GHS  25.50 →  2550
 *   GHS   1.00 →   100
 *   USD  10.99 →  1099
 *   GHS   0.00 →     0
 *   GHS   0.01 →     1
 *
 * NEVER use floating-point arithmetic for money.
 * ALWAYS use these utilities for any monetary operation.
 */

// ─── Currency Metadata ───

/** Currencies supported by the platform and their minor-unit decimal places */
const CURRENCY_DECIMALS: Record<string, number> = {
  GHS: 2,  // Ghanaian Cedi — 1 GHS = 100 pesewas
  USD: 2,  // US Dollar — 1 USD = 100 cents
  GBP: 2,  // British Pound — 1 GBP = 100 pence
  EUR: 2,  // Euro — 1 EUR = 100 cents
  KES: 2,  // Kenyan Shilling
  NGN: 2,  // Nigerian Naira
  ZAR: 2,  // South African Rand
  JPY: 0,  // Japanese Yen — no minor units
  KRW: 0,  // Korean Won — no minor units
};

/** Default currency for the platform */
export const DEFAULT_CURRENCY = 'GHS';

/** Default decimal places (2 for most currencies) */
export const DEFAULT_DECIMALS = 2;

/**
 * Get the number of decimal places for a currency.
 * Returns 2 for unknown currencies (safe default for minor-unit systems).
 */
export function getCurrencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency] ?? DEFAULT_DECIMALS;
}

/**
 * Get the minor-unit multiplier for a currency.
 * E.g., for GHS (2 decimals), returns 100.
 * E.g., for JPY (0 decimals), returns 1.
 */
export function getMinorUnitMultiplier(currency: string): number {
  const decimals = getCurrencyDecimals(currency);
  return Math.pow(10, decimals);
}

// ─── Type ───

/** Branded type for money in minor units — prevents accidental misuse as regular numbers */
export type Money = number & { readonly __brand: unique symbol };

/** Brand a number as Money (minor units). Use only when you KNOW the value is already in minor units. */
export function asMoney(value: number): Money {
  return value as Money;
}

// ─── Parsing ───

export interface ParseMoneyResult {
  success: true;
  value: Money;      // Integer minor units
  currency: string;
}

export interface ParseMoneyError {
  success: false;
  error: string;
}

export type ParseMoneyOutcome = ParseMoneyResult | ParseMoneyError;

/**
 * Parse a decimal monetary value into integer minor units.
 *
 * This function avoids floating-point errors by working with the string
 * representation of the number, not floating-point arithmetic.
 *
 * @param input - The monetary value as a number or string (e.g., 50.50, "25.99")
 * @param currency - ISO 4217 currency code (e.g., "GHS", "USD")
 * @returns ParseMoneyOutcome with the integer minor-unit value
 *
 * @example
 * parseMoney(50.50, 'GHS')   → { success: true, value: 5050 }
 * parseMoney("25.99", 'USD') → { success: true, value: 2599 }
 * parseMoney(0, 'GHS')       → { success: true, value: 0 }
 * parseMoney(0.01, 'GHS')    → { success: true, value: 1 }
 * parseMoney(-5, 'GHS')      → { success: false, error: '...' }  (negative rejected)
 * parseMoney(NaN, 'GHS')     → { success: false, error: '...' }
 */
export function parseMoney(input: unknown, currency: string = DEFAULT_CURRENCY): ParseMoneyOutcome {
  const decimals = getCurrencyDecimals(currency);

  // Reject null/undefined
  if (input === null || input === undefined) {
    return { success: false, error: 'Value is required' };
  }

  // Convert to string for safe parsing
  let str: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      return { success: false, error: 'Value must be a finite number' };
    }
    if (input < 0) {
      return { success: false, error: 'Value cannot be negative' };
    }
    // Use toFixed with sufficient precision to avoid floating-point representation errors
    // e.g., 0.1 + 0.2 = 0.30000000000000004 → toFixed(10) → "0.3000000000"
    str = input.toFixed(10);
  } else if (typeof input === 'string') {
    str = input.trim();
    if (str === '') {
      return { success: false, error: 'Value cannot be empty' };
    }
    if (!/^-?\d+(\.\d+)?$/.test(str)) {
      return { success: false, error: 'Value must be a valid decimal number' };
    }
    const numVal = parseFloat(str);
    if (numVal < 0) {
      return { success: false, error: 'Value cannot be negative' };
    }
  } else {
    return { success: false, error: 'Value must be a number or string' };
  }

  // Split into integer and decimal parts
  const isNegative = str.startsWith('-');
  if (isNegative) {
    return { success: false, error: 'Value cannot be negative' };
  }

  const parts = str.split('.');
  const intPart = parts[0] || '0';
  let decPart = parts[1] || '';

  // Trim decimal to the required precision
  if (decPart.length > decimals) {
    // Check if the extra digits would cause rounding
    const extraDigits = decPart.substring(decimals);
    const wouldRoundUp = extraDigits.split('').some(d => d !== '0');
    if (wouldRoundUp) {
      return {
        success: false,
        error: `Value has more than ${decimals} decimal places, which exceeds ${currency} precision`,
      };
    }
    // Truncate trailing zeros beyond precision
    decPart = decPart.substring(0, decimals);
  }

  // Pad decimal part to exactly `decimals` digits
  decPart = decPart.padEnd(decimals, '0');

  // Combine integer and decimal parts as a single integer string
  const combinedStr = intPart + decPart;

  // Parse to integer — this is safe because it's a string of digits
  const value = parseInt(combinedStr, 10);

  if (!Number.isSafeInteger(value)) {
    return { success: false, error: 'Value is too large for safe integer arithmetic' };
  }

  return { success: true, value: value as Money, currency };
}

/**
 * Parse a decimal monetary value, throwing on error.
 * Use when you're confident the input is valid (e.g., internal calculations).
 */
export function parseMoneyOrThrow(input: unknown, currency: string = DEFAULT_CURRENCY): Money {
  const result = parseMoney(input, currency);
  if (!result.success) {
    throw new Error(`parseMoney failed: ${result.error}`);
  }
  return result.value;
}

// ─── Formatting ───

/**
 * Format an integer minor-unit value as a decimal string for display.
 *
 * This function performs integer-only arithmetic to avoid floating-point errors.
 * It never uses toFixed() for2 as the foundation of correctness.
 *
 * @param minorUnits - The monetary value in integer minor units (e.g., 5050 for GHS 50.50)
 * @param currency - ISO 4217 currency code
 * @returns Formatted decimal string (e.g., "50.50")
 *
 * @example
 * formatMoney(505'50, 'GHS') → "50.50"
 * formatMoney(2550, 'GHS')   → "25.50"
 * formatMoney(100, 'GHS')    →( → "1.00"
 * formatMoney(0, 'GHS')      → "0.00"
 * formatMoney(1, 'GHS')      → "0.01"
 * formatMoney(1099, 'JPY')   → "1099"
 */
export function formatMoney(minorUnits: number, currency: string = DEFAULT_CURRENCY): string {
  const decimals = getCurrencyDecimals(currency);

  if (decimals === 0) {
    return String(minorUnits);
  }

  const isNegative = minorUnits < 0;
  const abs = Math.abs(minorUnits);

  const divisor = Math.pow(10, decimals);
  const intPart = Math.floor(abs / divisor);
  const decPart = abs % divisor;

  const decStr = String(decPart).padStart(decimals, '0');
  const intStr = String(intPart);

  return `${isNegative ? '-' : ''}${intStr}.${decStr}`;
}

/**
 * Format money with a currency symbol for display.
 *
 * @param minorUnits - The monetary value in integer minor units
 * @param currency - ISO 4217 currency code
 * @returns Formatted string with currency symbol (e.g., "₵50.50", "$10.99")
 *
 * @example
 * formatMoneyWithSymbol(5050, 'GHS') → "₵50.50"
 * formatMoneyWithSymbol(1099, 'USD') → "$10.99"
 * formatMoneyWithSymbol(0, 'GHS')    → "Free" (if zero)
 */
export function formatMoneyWithSymbol(minorUnits: number, currency: string = DEFAULT_CURRENCY): string {
  if (minorUnits === 0) return 'Free';
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${formatMoney(minorUnits, currency)}`;
}

/**
 * Get the display symbol for a currency.
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    GHS: '₵',
    USD: '$',
    GBP: '£',
    EUR: '€',
    KES: 'KSh',
    NGN: '₦',
    ZAR: 'R',
    JPY: '¥',
    KRW: '₩',
  };
  return symbols[currency] ?? currency + ' ';
}

// ─── Arithmetic (all on integer minor units) ───

/**
 * Add two monetary values (both must be in the same currency minor units).
 */
export function addMoney(a: Money, b: Money): Money {
  return (a + b) as Money;
}

/**
 * Subtract b from a (both must be in the same currency minor units).
 * Returns null if the result would be negative.
 */
export function subtractMoney(a: Money, b: Money): Money | null {
  const result = a - b;
  if (result < 0) return null;
  return result as Money;
}

/**
 * Multiply a monetary value by an integer quantity.
 * E.g., price * quantity for booking totals.
 *
 * @param amount - Monetary value in minor units
 * @param quantity - Integer quantity (must be non-negative)
 */
export function multiplyMoney(amount: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error('Quantity must be a non-negative integer');
  }
  return (amount * quantity) as Money;
}

/**
 * Calculate a percentage of a monetary value.
 * Returns the result rounded DOWN (floor) to avoid overcharging.
 *
 * @param amount - Monetary value in minor units
 * @param percentage - Percentage value (e.g., 5 for 5%, 2.5 for 2.5%)
 * @returns The percentage amount in minor units, floored
 *
 * @example
 * calculatePercentage(10000, 5)    → 500  (5% of GHS 100.00 = GHS 5.00)
 * calculatePercentage(999, 5)      → 49   (5% of GHS 9.99, floored to GHS 0.49)
 * calculatePercentage(10000, 2.5)  → 250  (2.5% of GHS 100.00 = GHS 2.50)
 */
export function calculatePercentage(amount: Money, percentage: number): Money {
  if (percentage < 0) throw new Error('Percentage cannot be negative');
  // Use integer-safe calculation:
  // For integer percentages: (amount * percentage) / 100
  // For fractional percentages: Math.floor((amount * percentage) / 100)
  // This avoids floating-point errors for common percentages
  return Math.floor((amount * percentage) / 100) as Money;
}

/**
 * Calculate a platform fee from a monetary amount.
 * Platform fees are always floored (rounded down) to avoid overcharging.
 *
 * @param amount - The base monetary value in minor units
 * @param feePercent - The platform fee percentage (e.g., 5 for 5%)
 * @returns The fee amount in minor units
 */
export function calculatePlatformFee(amount: Money, feePercent: number): Money {
  return calculatePercentage(amount, feePercent);
}

/**
 * Calculate the organizer's net revenue after platform fee deduction.
 *
 * @param amount - The gross monetary value in minor units
 * @param feePercent - The platform fee percentage
 * @returns The net amount after fee deduction
 */
export function calculateOrganizerRevenue(amount: Money, feePercent: number): Money {
  const fee = calculatePlatformFee(amount, feePercent);
  return (amount - fee) as Money;
}

// ─── Validation ───

/**
 * Check if a value is a valid Money (non-negative safe integer).
 */
export function isValidMoney(value: unknown): value is Money {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Assert that a value is valid Money, throwing if not.
 */
export function assertValidMoney(value: unknown, label: string = 'value'): asserts value is Money {
  if (!isValidMoney(value)) {
    throw new Error(`Invalid money ${label}: expected non-negative safe integer, got ${value}`);
  }
}

/**
 * Check if a monetary value represents a free/zero amount.
 */
export function isFree(amount: Money): boolean {
  return amount === 0;
}
