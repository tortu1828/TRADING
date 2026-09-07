import * as XLSX from 'xlsx';
import { InvestorApplication } from '../types';

export interface ParsedApplicationRow {
  excelTurno?: number;
  fullName: string;
  documentId?: string;
  email?: string;
  phone?: string;
  city?: string;
  requestedCapitalCop: number;
  originBank?: string;
  submissionDate?: string;
  notes?: string;
}

/**
 * Normaliza claves de encabezados de Excel eliminando tildes, mayúsculas y espacios.
 */
function cleanHeaderKey(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Convierte valores de capital con formato de texto (ej. "$8.000.000 COP") a número limpio
 */
function parseCapitalValue(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 8_000_000;
  const str = String(val).replace(/[^0-9]/g, '');
  const num = parseInt(str, 10);
  return isNaN(num) ? 8_000_000 : num;
}

/**
 * Procesa un objeto de fila extraído de Excel SheetJS
 */
function mapRawRowToApplication(rawRow: Record<string, any>, index: number): ParsedApplicationRow | null {
  const normalizedKeys: Record<string, any> = {};
  for (const [k, v] of Object.entries(rawRow)) {
    normalizedKeys[cleanHeaderKey(k)] = v;
  }

  // Detectar Nombre (obligatorio)
  const fullName =
    normalizedKeys['nombre'] ||
    normalizedKeys['nombrecompleto'] ||
    normalizedKeys['inversionista'] ||
    normalizedKeys['solicitante'] ||
    normalizedKeys['postulante'] ||
    normalizedKeys['cliente'] ||
    normalizedKeys['nombres'] ||
    rawRow['Nombre'] ||
    rawRow['NOMBRE'] ||
    rawRow['Nombre Completo'];

  if (!fullName || String(fullName).trim().length < 2) {
    return null;
  }

  // Detectar Turno / Orden
  const rawTurno =
    normalizedKeys['turno'] ||
    normalizedKeys['orden'] ||
    normalizedKeys['posicion'] ||
    normalizedKeys['puesto'] ||
    normalizedKeys['num'] ||
    normalizedKeys['item'] ||
    normalizedKeys['consecutivo'];

  const parsedTurno = rawTurno ? parseInt(String(rawTurno).replace(/[^0-9]/g, ''), 10) : undefined;

  // Detectar Documento / Cédula
  const documentId =
    normalizedKeys['documento'] ||
    normalizedKeys['cedula'] ||
    normalizedKeys['cc'] ||
    normalizedKeys['nit'] ||
    normalizedKeys['identificacion'] ||
    normalizedKeys['id'] ||
    '';

  // Detectar Teléfono / Celular / WhatsApp
  const phone =
    normalizedKeys['telefono'] ||
    normalizedKeys['celular'] ||
    normalizedKeys['whatsapp'] ||
    normalizedKeys['movil'] ||
    normalizedKeys['contacto'] ||
    '';

  // Detectar Email
  const email =
    normalizedKeys['email'] ||
    normalizedKeys['correo'] ||
    normalizedKeys['correoelectronico'] ||
    normalizedKeys['mail'] ||
    '';

  // Detectar Ciudad
  const city =
    normalizedKeys['ciudad'] ||
    normalizedKeys['ubicacion'] ||
    normalizedKeys['municipio'] ||
    'Colombia';

  // Detectar Capital
  const rawCapital =
    normalizedKeys['capital'] ||
    normalizedKeys['capitalpropuesto'] ||
    normalizedKeys['monto'] ||
    normalizedKeys['valor'] ||
    normalizedKeys['inversion'] ||
    normalizedKeys['aporte'] ||
    normalizedKeys['capitalcop'];

  const requestedCapitalCop = parseCapitalValue(rawCapital);

  // Detectar Banco
  const originBank =
    normalizedKeys['banco'] ||
    normalizedKeys['bancoorigen'] ||
    normalizedKeys['entidad'] ||
    normalizedKeys['metodo'] ||
    'Bancolombia';

  // Detectar Fecha
  let submissionDate: string | undefined = undefined;
  const rawDate =
    normalizedKeys['fecha'] ||
    normalizedKeys['fecharadicacion'] ||
    normalizedKeys['fechasolicitud'] ||
    normalizedKeys['fechallegada'] ||
    normalizedKeys['radicado'];

  if (rawDate) {
    if (typeof rawDate === 'number') {
      // Excel serial date number
      const dateObj = new Date((rawDate - (25567 + 2)) * 86400 * 1000);
      if (!isNaN(dateObj.getTime())) {
        submissionDate = dateObj.toISOString();
      }
    } else {
      const parsed = new Date(String(rawDate));
      if (!isNaN(parsed.getTime())) {
        submissionDate = parsed.toISOString();
      }
    }
  }

  // Detectar Notas / Referido
  const notes =
    normalizedKeys['notas'] ||
    normalizedKeys['nota'] ||
    normalizedKeys['observaciones'] ||
    normalizedKeys['referido'] ||
    normalizedKeys['comentarios'] ||
    `Fila ${index + 1} de Excel Histórico (Orden de llegada)`;

  return {
    excelTurno: parsedTurno && !isNaN(parsedTurno) ? parsedTurno : index + 1,
    fullName: String(fullName).trim(),
    documentId: String(documentId).trim(),
    phone: String(phone).trim(),
    email: String(email).trim().toLowerCase(),
    city: String(city).trim(),
    requestedCapitalCop,
    originBank: String(originBank).trim(),
    submissionDate: submissionDate || new Date().toISOString(),
    notes: String(notes).trim(),
  };
}

/**
 * Lee un archivo .xlsx, .xls o .csv y devuelve las filas mapeadas respetando el orden
 */
export async function parseExcelApplicationsFile(file: File): Promise<ParsedApplicationRow[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('El archivo de Excel no contiene ninguna hoja de cálculo.');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('La hoja seleccionada está vacía.');
  }

  const results: ParsedApplicationRow[] = [];
  rawRows.forEach((row, idx) => {
    const mapped = mapRawRowToApplication(row, idx);
    if (mapped) {
      results.push(mapped);
    }
  });

  return results;
}

/**
 * Parsea texto tabulado copiado directamente de Excel (Ctrl+C en Excel -> Pegar)
 */
export function parsePastedApplicationsText(pastedText: string): ParsedApplicationRow[] {
  const lines = pastedText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Verificar si la primera fila es encabezado
  const firstLineCols = lines[0].split('\t');
  const isHeader = firstLineCols.some((c) => {
    const cl = c.toLowerCase();
    return cl.includes('nom') || cl.includes('ced') || cl.includes('doc') || cl.includes('tel') || cl.includes('cap');
  });

  const dataLines = isHeader ? lines.slice(1) : lines;
  const results: ParsedApplicationRow[] = [];

  dataLines.forEach((line, idx) => {
    const cols = line.split('\t').map((c) => c.trim());
    if (cols.length === 0 || !cols[0]) return;

    // Si tiene al menos 2 columnas
    let fullName = '';
    let documentId = '';
    let phone = '';
    let email = '';
    let capitalStr = '';
    let notes = '';

    if (cols.length === 1) {
      fullName = cols[0];
    } else if (cols.length === 2) {
      fullName = cols[0];
      capitalStr = cols[1];
    } else if (cols.length >= 3) {
      fullName = cols[0];
      documentId = cols[1];
      phone = cols[2];
      if (cols.length >= 4) capitalStr = cols[3];
      if (cols.length >= 5) email = cols[4];
      if (cols.length >= 6) notes = cols.slice(5).join(' - ');
    }

    if (fullName) {
      results.push({
        excelTurno: idx + 1,
        fullName,
        documentId,
        phone,
        email,
        requestedCapitalCop: parseCapitalValue(capitalStr),
        originBank: 'Bancolombia',
        submissionDate: new Date().toISOString(),
        notes: notes || `Pegado desde portapapeles Excel (Fila ${idx + 1})`,
      });
    }
  });

  return results;
}

/**
 * Genera y descarga una plantilla oficial en formato .xlsx
 */
export function downloadApplicationsExcelTemplate() {
  const sampleData = [
    {
      'Turno / Orden': 1,
      'Nombre Completo': 'Mariana Gómez Restrepo',
      'Cédula / Documento': '1037648291',
      'WhatsApp / Teléfono': '3124567890',
      'Correo Electrónico': 'mariana.gomez@gmail.com',
      'Ciudad': 'Medellín',
      'Capital a Invertir (COP)': 15000000,
      'Banco de Origen': 'Bancolombia',
      'Fecha Radicación': '2026-08-20',
      'Observaciones / Referido': 'Solicitud #1 histórica lista de espera. Aspira a Bitácora Verde.',
    },
    {
      'Turno / Orden': 2,
      'Nombre Completo': 'Andrés Felipe Cardona',
      'Cédula / Documento': '71829401',
      'WhatsApp / Teléfono': '3109876543',
      'Correo Electrónico': 'andres.cardona@hotmail.com',
      'Ciudad': 'Bogotá',
      'Capital a Invertir (COP)': 8000000,
      'Banco de Origen': 'Davivienda',
      'Fecha Radicación': '2026-08-22',
      'Observaciones / Referido': 'Solicitud #2 histórica. Aspira a grupo $8M Bitácora Azul.',
    },
    {
      'Turno / Orden': 3,
      'Nombre Completo': 'Laura Sofía Mendoza',
      'Cédula / Documento': '1017283940',
      'WhatsApp / Teléfono': '3156789012',
      'Correo Electrónico': 'laura.mendoza@outlook.com',
      'Ciudad': 'Cali',
      'Capital a Invertir (COP)': 35000000,
      'Banco de Origen': 'Bancolombia',
      'Fecha Radicación': '2026-08-25',
      'Observaciones / Referido': 'Referida por Juan Pérez (USR-8F29K).',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  // Anchos de columna
  worksheet['!cols'] = [
    { wch: 14 }, // Turno
    { wch: 28 }, // Nombre
    { wch: 20 }, // Documento
    { wch: 20 }, // Teléfono
    { wch: 28 }, // Correo
    { wch: 16 }, // Ciudad
    { wch: 24 }, // Capital
    { wch: 18 }, // Banco
    { wch: 18 }, // Fecha
    { wch: 40 }, // Notas
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Solicitudes_Orden_Llegada');
  XLSX.writeFile(workbook, 'Plantilla_Solicitudes_Nuevos_Ingresos_EasyTraders.xlsx');
}

/**
 * Exporta las solicitudes actuales a un archivo Excel ordenado por turno
 */
export function exportApplicationsToExcelFile(applications: InvestorApplication[]) {
  const exportData = applications.map((app) => ({
    'Turno FIFO': app.queuePosition,
    'Estado': app.status === 'APPROVED' ? 'Aprobada' : app.status === 'REJECTED' ? 'Rechazada' : 'Pendiente en Cola',
    'Nombre Completo': app.fullName,
    'Cédula / Documento': app.documentId || 'No registrado',
    'WhatsApp / Teléfono': app.phone,
    'Correo Electrónico': app.email,
    'Ciudad': app.city || 'Colombia',
    'Capital Solicitado (COP)': app.requestedCapitalCop,
    'Banco de Origen': app.originBank || 'Bancolombia',
    'Origen': app.source === 'EXCEL_HISTORICO' ? 'Excel Antiguo' : app.source === 'WEB_FORM' ? 'Formulario Web' : 'Registro Manual',
    'Fecha de Llegada': new Date(app.submissionDate).toLocaleString('es-CO'),
    'Código Asignado': app.assignedUserCode || 'Pendiente',
    'Fecha Resolución': app.resolvedAt ? new Date(app.resolvedAt).toLocaleString('es-CO') : 'Sin resolver',
    'Atendido Por': app.resolvedBy || '-',
    'Motivo Rechazo': app.rejectionReason || '-',
    'Notas': app.priorityNotes || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 18 },
    { wch: 28 },
    { wch: 20 },
    { wch: 18 },
    { wch: 26 },
    { wch: 16 },
    { wch: 24 },
    { wch: 18 },
    { wch: 18 },
    { wch: 22 },
    { wch: 18 },
    { wch: 22 },
    { wch: 22 },
    { wch: 25 },
    { wch: 35 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cola_Admisiones_EasyTraders');
  XLSX.writeFile(workbook, `Cola_Admision_EasyTraders_${new Date().toISOString().split('T')[0]}.xlsx`);
}
