import { BitacoraCategory } from '../types';

export const BITACORA_RANGES: Record<BitacoraCategory, { min: number; max: number; name: string }> = {
  AZUL: {
    min: 7_000_000,
    max: 9_999_999.99,
    name: '🔵 Azul',
  },
  VERDE: {
    min: 10_000_000,
    max: 49_999_999.99,
    name: '🟢 Verde',
  },
  NEGRA: {
    min: 50_000_000,
    max: 1_000_000_000,
    name: '⚫ Negra / Whale',
  },
};

/**
 * Determina automáticamente la categoría (bitácora) según el capital operativo.
 * Regla:
 * - AZUL: >= $7.000.000 y < $10.000.000
 * - VERDE: >= $10.000.000 y < $50.000.000
 * - NEGRA / WHALE: >= $50.000.000 y <= $1.000.000.000
 */
export function getCategoryForCapital(capital: number): BitacoraCategory {
  if (capital >= 50_000_000) {
    return 'NEGRA';
  }
  if (capital >= 10_000_000) {
    return 'VERDE';
  }
  return 'AZUL';
}

export function validateCapitalForCategory(capital: number, category: BitacoraCategory): boolean {
  if (category === 'AZUL') {
    return capital >= 7_000_000 && capital < 10_000_000;
  }
  if (category === 'VERDE') {
    return capital >= 10_000_000 && capital < 50_000_000;
  }
  if (category === 'NEGRA') {
    return capital >= 50_000_000 && capital <= 1_000_000_000;
  }
  return false;
}

export interface CalculationResult {
  usdOperated: number;
  trmUsed: number;
  grossCop: number;
  userPercentage: number;
  adminPercentage: number;
  userProfitCop: number;
  userProfitUsd: number;
  adminCommissionCop: number;
  adminCommissionUsd: number;
  isValidBalance: boolean;
}

/**
 * Ejecuta el cálculo individual para un usuario conforme a las reglas V2.1:
 * grossCop = usdOperated * trmUsed
 * userProfitCop = grossCop * (userPercentage / 100)
 * adminCommissionCop = grossCop * (adminPercentage / 100)
 *
 * userPercentage + adminPercentage = 100
 * userProfitCop + adminCommissionCop = grossCop
 */
export function calculateUserMonthlyResult(
  usdOperated: number,
  trmUsed: number,
  userPercentage: number,
  adminPercentage: number
): CalculationResult {
  // Validación de split
  const sumPercentage = Math.round((userPercentage + adminPercentage) * 100) / 100;
  if (sumPercentage !== 100) {
    throw new Error(`Los porcentajes deben sumar exactamente 100%. Suma actual: ${sumPercentage}%`);
  }

  const grossCop = usdOperated * trmUsed;
  const userRatio = userPercentage / 100;
  const adminRatio = adminPercentage / 100;

  const userProfitCop = grossCop * userRatio;
  const adminCommissionCop = grossCop * adminRatio;

  const userProfitUsd = usdOperated * userRatio;
  const adminCommissionUsd = usdOperated * adminRatio;

  const balanceCheck = Math.abs((userProfitCop + adminCommissionCop) - grossCop) < 0.001;

  return {
    usdOperated,
    trmUsed,
    grossCop,
    userPercentage,
    adminPercentage,
    userProfitCop,
    userProfitUsd,
    adminCommissionCop,
    adminCommissionUsd,
    isValidBalance: balanceCheck,
  };
}

/**
 * Formateador de moneda colombiana COP
 */
export function formatCOP(amount: number, compact: boolean = false): string {
  if (isNaN(amount)) return '$ 0 COP';
  if (compact && amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `$${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M COP`;
  }
  const formatted = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
  return formatted;
}

/**
 * Formateador de moneda estadounidense USD
 */
export function formatUSD(amount: number): string {
  if (isNaN(amount)) return 'USD $0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Formateador de TRM
 */
export function formatTRM(trm: number): string {
  if (isNaN(trm)) return '$4.000';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(trm);
}

/**
 * Generador de código único de usuario (ej. USR-8F29K)
 */
export function generateUserCode(existingCodes: string[] = []): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let attempts = 0;
  while (attempts < 1000) {
    let code = 'USR-';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (!existingCodes.includes(code)) {
      return code;
    }
    attempts++;
  }
  return `USR-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}
