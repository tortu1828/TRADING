import * as XLSX from 'xlsx';
import { BitacoraCategory, ImportedBitacoraRow, UserProfile } from '../types';

/**
 * Utility to parse number strings from Excel (e.g. "$6.000.000", "2,501,000", "807", "6.000.000 COP")
 */
export function parseExcelNumber(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  
  const str = String(val).trim();
  if (!str) return 0;

  // Check if it's in Colombian/Spanish notation e.g. "6.000.000" or "$ 6.000.000,00"
  // Remove currency signs, spaces, and letters
  let cleaned = str.replace(/[$COPusdUSD\s]/g, '');

  // If format like "6.000.000,50", replace dots and change comma to dot
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes('.') && !cleaned.includes(',')) {
    // If multiple dots like "6.000.000" -> Colombian thousands separator
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1 || (dotCount === 1 && cleaned.split('.')[1].length === 3)) {
      cleaned = cleaned.replace(/\./g, '');
    }
  } else if (cleaned.includes(',') && !cleaned.includes('.')) {
    const commaCount = (cleaned.match(/,/g) || []).length;
    if (commaCount > 1 || (commaCount === 1 && cleaned.split(',')[1].length === 3)) {
      cleaned = cleaned.replace(/,/g, '');
    } else {
      cleaned = cleaned.replace(',', '.');
    }
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Normalize string for fuzzy/accent-insensitive comparison
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Determine category based on capital COP
 */
export function getCategoryFromCapital(capitalCop: number): BitacoraCategory {
  if (capitalCop >= 50000000) return 'NEGRA';
  if (capitalCop >= 10000000) return 'VERDE';
  return 'AZUL';
}

/**
 * Parse Month/Year header if present (e.g. "AGOSTO DE 2026" or "SEPTIEMBRE 2026")
 */
export function parseMonthHeader(headerText: string): { cycleId?: string; cycleName?: string } {
  if (!headerText) return {};
  
  const text = headerText.toUpperCase();
  const months: Record<string, string> = {
    ENERO: '01',
    FEBRERO: '02',
    MARZO: '03',
    ABRIL: '04',
    MAYO: '05',
    JUNIO: '06',
    JULIO: '07',
    AGOSTO: '08',
    SEPTIEMBRE: '09',
    OCTUBRE: '10',
    NOVIEMBRE: '11',
    DICIEMBRE: '12',
  };

  let foundMonth = '';
  let foundMonthName = '';
  for (const [mName, mNum] of Object.entries(months)) {
    if (text.includes(mName)) {
      foundMonth = mNum;
      foundMonthName = mName.charAt(0) + mName.slice(1).toLowerCase();
      break;
    }
  }

  const yearMatch = text.match(/20\d{2}/);
  const foundYear = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();

  if (foundMonth) {
    return {
      cycleId: `${foundYear}-${foundMonth}`,
      cycleName: `${foundMonthName} ${foundYear}`,
    };
  }

  return {};
}

export interface ParseExcelResult {
  detectedCycleId?: string;
  detectedCycleName?: string;
  rows: ImportedBitacoraRow[];
  errors: string[];
}

/**
 * Parse an uploaded Excel (.xlsx, .xls) or CSV File
 */
export async function parseExcelBitacoraFile(
  file: File,
  existingUsers: UserProfile[],
  forceCategory?: BitacoraCategory
): Promise<ParseExcelResult> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  // Use the first sheet or find sheet named 'Bitacora' / 'Agosto' etc.
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    return { rows: [], errors: ['No se encontró ninguna hoja válida en el archivo Excel.'] };
  }

  // Convert worksheet to raw array of arrays
  const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (rawRows.length === 0) {
    return { rows: [], errors: ['La hoja de Excel está vacía.'] };
  }

  let detectedCycleId: string | undefined;
  let detectedCycleName: string | undefined;
  let headerRowIndex = -1;

  // Look through the first 5 rows to detect title (e.g. "AGOSTO DE 2026") and column headers
  for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
    const row = rawRows[r];
    const rowString = row.join(' ').trim();

    // Try detecting Month title
    if (!detectedCycleId && rowString) {
      const monthInfo = parseMonthHeader(rowString);
      if (monthInfo.cycleId) {
        detectedCycleId = monthInfo.cycleId;
        detectedCycleName = monthInfo.cycleName;
      }
    }

    // Check if this row contains the columns headers
    const normRow = row.map((cell) => String(cell).toUpperCase().trim());
    const hasClientCol = normRow.some(
      (c) => c.includes('CLIENTE') || c.includes('NOMBRE') || c.includes('INVERSIONISTA') || c.includes('TITULAR')
    );
    const hasCapitalCol = normRow.some((c) => c.includes('CAPITAL') || c.includes('INVERTIDO') || c.includes('COP'));

    if (hasClientCol && hasCapitalCol) {
      headerRowIndex = r;
      break;
    }
  }

  if (headerRowIndex === -1) {
    // If no explicit header row found, assume row 0 or 1
    headerRowIndex = rawRows[0].length >= 3 ? 0 : 1;
  }

  const headerRow = rawRows[headerRowIndex] || [];
  const colIndexMap = {
    client: -1,
    capitalCop: -1,
    totalUsd: -1,
    totalCop: -1,
    clientCop: -1,
    commissionCop: -1,
    status: -1,
  };

  // Find column indices
  headerRow.forEach((cell, idx) => {
    const text = String(cell).toUpperCase().trim();
    if (
      colIndexMap.client === -1 &&
      (text.includes('CLIENTE') || text.includes('NOMBRE') || text.includes('INVERSIONISTA') || text.includes('TITULAR'))
    ) {
      colIndexMap.client = idx;
    } else if (
      colIndexMap.capitalCop === -1 &&
      (text.includes('CAPITAL') || (text.includes('INVERTIDO') && text.includes('COP')))
    ) {
      colIndexMap.capitalCop = idx;
    } else if (
      colIndexMap.totalUsd === -1 &&
      (text.includes('USD') || text.includes('DOLAR') || text.includes('DOLARES'))
    ) {
      colIndexMap.totalUsd = idx;
    } else if (
      colIndexMap.totalCop === -1 &&
      (text.includes('TOTAL GANANCIAS COP') || (text.includes('GANANCIAS') && text.includes('COP')) || text === 'TOTAL COP')
    ) {
      colIndexMap.totalCop = idx;
    } else if (
      colIndexMap.clientCop === -1 &&
      (text.includes('TOTAL CLIENTE') || text.includes('CLIENTE COP') || text.includes('PAGO CLIENTE') || text.includes('GANANCIA CLIENTE'))
    ) {
      colIndexMap.clientCop = idx;
    } else if (
      colIndexMap.commissionCop === -1 &&
      (text.includes('COMISION') || text.includes('ADMIN') || text.includes('EASYTRADERS'))
    ) {
      colIndexMap.commissionCop = idx;
    } else if (
      colIndexMap.status === -1 &&
      (text.includes('ESTADO') || text.includes('STATUS') || text.includes('PAGO'))
    ) {
      colIndexMap.status = idx;
    }
  });

  // Fallbacks if columns weren't identified by exact keywords
  if (colIndexMap.client === -1) colIndexMap.client = 0;
  if (colIndexMap.capitalCop === -1) colIndexMap.capitalCop = 1;
  if (colIndexMap.totalUsd === -1) colIndexMap.totalUsd = 2;
  if (colIndexMap.totalCop === -1) colIndexMap.totalCop = 3;
  if (colIndexMap.clientCop === -1) colIndexMap.clientCop = 4;
  if (colIndexMap.commissionCop === -1) colIndexMap.commissionCop = 5;
  if (colIndexMap.status === -1) colIndexMap.status = 6;

  const parsedRows: ImportedBitacoraRow[] = [];
  const errors: string[] = [];

  // Parse data rows starting after header
  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const rawClientName = String(row[colIndexMap.client] || '').trim();
    if (!rawClientName) continue;

    // Ignore summary footer rows (e.g. "TOTAL", "TOTALES", "SUMA")
    const upperName = rawClientName.toUpperCase();
    if (upperName === 'TOTAL' || upperName === 'TOTALES' || upperName === 'SUMA' || upperName.startsWith('TOTAL:')) {
      continue;
    }

    const capitalCop = parseExcelNumber(row[colIndexMap.capitalCop]);
    const totalUsd = parseExcelNumber(row[colIndexMap.totalUsd]);
    let totalCop = parseExcelNumber(row[colIndexMap.totalCop]);
    let clientCop = parseExcelNumber(row[colIndexMap.clientCop]);
    let commissionCop = parseExcelNumber(row[colIndexMap.commissionCop]);
    const rawStatus = String(row[colIndexMap.status] || 'PAGO').trim().toUpperCase();
    const status = rawStatus.includes('PAG') || rawStatus === 'OK' ? 'PAGO' : 'PENDIENTE';

    // Auto-compute derived totals if missing
    if (totalCop === 0 && (clientCop > 0 || commissionCop > 0)) {
      totalCop = clientCop + commissionCop;
    }
    if (clientCop === 0 && totalCop > 0) {
      clientCop = Math.round(totalCop * 0.5); // Default 50% or standard split
      commissionCop = totalCop - clientCop;
    }

    const category = forceCategory || getCategoryFromCapital(capitalCop);

    // Fuzzy matching against existing users
    const normName = normalizeName(rawClientName);
    const matchedUser = existingUsers.find((u) => {
      const uNorm = normalizeName(u.fullName);
      return uNorm === normName || uNorm.includes(normName) || normName.includes(uNorm);
    });

    parsedRows.push({
      rawId: `row-${r}-${Date.now()}`,
      clientName: rawClientName.toUpperCase(),
      capitalCop,
      totalUsdEarnings: totalUsd,
      totalCopEarnings: totalCop,
      totalClientCop: clientCop,
      totalCommissionCop: commissionCop,
      status,
      category,
      isNewUser: !matchedUser,
      matchedUserId: matchedUser?.id,
      matchedUserCode: matchedUser?.userCode,
      notes: matchedUser ? `Usuario existente: ${matchedUser.userCode}` : 'Nuevo inversionista a crear',
    });
  }

  return {
    detectedCycleId,
    detectedCycleName,
    rows: parsedRows,
    errors,
  };
}

/**
 * Generate a downloadable sample Excel file template (.xlsx)
 */
export function downloadSampleBitacoraExcel(categoryName: string = 'General'): void {
  const sampleData = [
    ['AGOSTO DE 2026', '', '', '', '', '', ''],
    [
      'CLIENTES',
      'CAPITAL INVERTIDO COP',
      'TOTAL USD GANANCIAS',
      'TOTAL GANANCIAS COP',
      'TOTAL CLIENTE COP',
      'TOTAL COMISION COP',
      'ESTADO',
    ],
    ['MARIA JOSE ROD', 6000000, 807, 2501000, 1250000, 1250000, 'PAGO'],
    ['JORGE HURTADO', 6000000, 807, 2501000, 1250000, 1250000, 'PAGO'],
    ['MARIANA RIVERA', 5000000, 778, 2411000, 1205000, 1205000, 'PAGO'],
    ['CARLOS BEDOYA', 5000000, 778, 2411000, 1205000, 1205000, 'PAGO'],
    ['KHATERIN JARA', 5000000, 778, 2411000, 1205000, 1205000, 'PAGO'],
    ['CARLOS FRANCO', 5000000, 778, 2411000, 1205000, 1205000, 'PAGO'],
    ['MATEO MERCHAN', 5000000, 671, 2080000, 1040000, 1040000, 'PAGO'],
    ['MARI AGUIRRE', 4000000, 753, 2334000, 1167000, 1167000, 'PAGO'],
    ['KAROL LEON', 4000000, 753, 2334000, 1167000, 1167000, 'PAGO'],
    ['ISABELLA SUATE', 4000000, 753, 2334000, 1167000, 1167000, 'PAGO'],
    ['VANESA BLANDO', 4000000, 753, 2334000, 1167000, 1167000, 'PAGO'],
    ['LUISA FERNANDA PINEDA CARDONA', 3000000, 396, 1227000, 613000, 613000, 'PAGO'],
    ['DAVID ORTIZ G', 3000000, 691, 2142000, 1071000, 1071000, 'PAGO'],
    ['LUISA BAUTISTA', 3000000, 80, 248000, 124000, 124000, 'PAGO'],
    ['NAYDY CANO', 2000000, 628, 1946000, 973000, 973000, 'PAGO'],
    ['EVELYN OROZCO', 2000000, 628, 1946000, 973000, 973000, 'PAGO'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sampleData);

  // Set column widths
  ws['!cols'] = [
    { wch: 32 }, // CLIENTES
    { wch: 24 }, // CAPITAL INVERTIDO COP
    { wch: 22 }, // TOTAL USD GANANCIAS
    { wch: 22 }, // TOTAL GANANCIAS COP
    { wch: 20 }, // TOTAL CLIENTE COP
    { wch: 20 }, // TOTAL COMISION COP
    { wch: 12 }, // ESTADO
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bitácora');

  XLSX.writeFile(wb, `Plantilla_Bitacora_${categoryName}_EasyTraders.xlsx`);
}
