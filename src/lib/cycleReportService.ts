/**
 * ============================================================================
 * SERVICIO CLIENTE: INFORMES OFICIALES DE CIERRE POR CICLO (SUPERADMIN)
 * ============================================================================
 * Consume snapshots inmutables y ejecuta la generación de PDFs oficiales
 * bajo demanda a través de Cloud Functions sin persistencia permanente en cliente.
 */

import { db, functions, httpsCallable } from './firebase';
import { collection, doc, getDoc, getDocs, query, orderBy, where } from 'firebase/firestore';
import { CycleReportMetadata, CycleReportUserSnapshot, CycleReportHeaderDoc } from '../types';

export interface CycleReportItem {
  cycleId: string;
  cycleName: string;
  closedAt: string;
  trmApplied: number;
  hasReport: boolean;
  currentVersionId?: string;
  currentVersionNumber?: number;
  reportStatus?: 'READY' | 'SUPERSEDED' | 'FAILED';
  totalUsers?: number;
  totalManagedCapital?: number;
}

class CycleReportService {
  /**
   * Obtiene la lista de ciclos cerrados y el estado de su informe oficial.
   */
  public async getClosedCyclesWithReportStatus(): Promise<CycleReportItem[]> {
    try {
      // 1. Obtener todos los ciclos cerrados de monthlyCycles
      const cyclesQuery = query(collection(db, 'monthlyCycles'), where('status', '==', 'CLOSED'));
      const cyclesSnap = await getDocs(cyclesQuery);

      const items: CycleReportItem[] = [];

      for (const cycleDoc of cyclesSnap.docs) {
        const cData = cycleDoc.data();
        const cycleId = cycleDoc.id;
        const cycleName = cData.name || cData.title || cycleId;
        const closedAt = cData.closedAt || cData.endDate || '';
        const trmApplied = Number(cData.trmApplied || cData.trmFinal || cData.trmSnapshot || 0);

        // Consultar cabecera de cycleReports
        let hasReport = false;
        let currentVersionId: string | undefined;
        let currentVersionNumber: number | undefined;
        let reportStatus: 'READY' | 'SUPERSEDED' | 'FAILED' | undefined;
        let totalUsers: number | undefined;
        let totalManagedCapital: number | undefined;

        try {
          const reportHeaderSnap = await getDoc(doc(db, 'cycleReports', cycleId));
          if (reportHeaderSnap.exists()) {
            const hData = reportHeaderSnap.data() as CycleReportHeaderDoc;
            hasReport = true;
            currentVersionId = hData.currentVersionId;
            currentVersionNumber = hData.currentVersionNumber;
            reportStatus = hData.status;
          } else {
            // Verificar si existen versiones directamente
            const vSnap = await getDocs(collection(db, 'cycleReports', cycleId, 'versions'));
            if (!vSnap.empty) {
              hasReport = true;
              const vDocs = vSnap.docs.map((d) => d.data() as CycleReportMetadata);
              const current = vDocs.find((v) => v.isCurrent) || vDocs[0];
              currentVersionId = current.versionId;
              currentVersionNumber = current.versionNumber;
              reportStatus = current.status;
              totalUsers = current.totalUsers;
              totalManagedCapital = current.totalManagedCapital;
            }
          }
        } catch (repErr) {
          console.warn(`[CycleReportService] No se pudo leer cycleReports para ${cycleId}:`, repErr);
        }

        items.push({
          cycleId,
          cycleName,
          closedAt,
          trmApplied,
          hasReport,
          currentVersionId,
          currentVersionNumber,
          reportStatus,
          totalUsers,
          totalManagedCapital,
        });
      }

      // Ordenar por fecha de cierre descendente
      items.sort((a, b) => new Date(b.closedAt || 0).getTime() - new Date(a.closedAt || 0).getTime());
      return items;
    } catch (err) {
      console.error('[CycleReportService] Error en getClosedCyclesWithReportStatus:', err);
      throw err;
    }
  }

  /**
   * Obtiene el historial de versiones inmutables de un ciclo.
   */
  public async getCycleReportVersions(cycleId: string): Promise<CycleReportMetadata[]> {
    try {
      const versionsQuery = query(
        collection(db, 'cycleReports', cycleId, 'versions'),
        orderBy('versionNumber', 'desc')
      );
      const snap = await getDocs(versionsQuery);
      return snap.docs.map((d) => d.data() as CycleReportMetadata);
    } catch (err) {
      console.warn('[CycleReportService] Error leyendo versiones directamente, intentando callable:', err);
      const callable = httpsCallable<{ cycleId: string }, { versions: CycleReportMetadata[] }>(
        functions,
        'adminGetCycleReportVersionsCallable'
      );
      const res = await callable({ cycleId });
      return res.data.versions || [];
    }
  }

  /**
   * Obtiene los metadatos y la lista congelada de usuarios de una versión de informe.
   */
  public async getCycleReportDetails(
    cycleId: string,
    versionId: string
  ): Promise<{ metadata: CycleReportMetadata; users: CycleReportUserSnapshot[] }> {
    try {
      const vRef = doc(db, 'cycleReports', cycleId, 'versions', versionId);
      const vSnap = await getDoc(vRef);
      if (!vSnap.exists()) {
        throw new Error(`La versión '${versionId}' del ciclo '${cycleId}' no existe.`);
      }
      const metadata = vSnap.data() as CycleReportMetadata;

      const usersSnap = await getDocs(collection(vRef, 'users'));
      const users: CycleReportUserSnapshot[] = [];
      usersSnap.forEach((d) => users.push(d.data() as CycleReportUserSnapshot));

      users.sort((a, b) => (a.userCode || '').localeCompare(b.userCode || ''));

      return { metadata, users };
    } catch (err) {
      console.warn('[CycleReportService] Error leyendo detalles directamente, usando callable:', err);
      const callable = httpsCallable<
        { cycleId: string; versionId: string },
        { metadata: CycleReportMetadata; users: CycleReportUserSnapshot[] }
      >(functions, 'adminGetCycleReportDetailsCallable');
      const res = await callable({ cycleId, versionId });
      return res.data;
    }
  }

  /**
   * Genera un informe retrospectivo para un ciclo ya cerrado que carece de snapshot.
   */
  public async generateRetrospectiveReport(cycleId: string): Promise<CycleReportMetadata> {
    const callable = httpsCallable<{ cycleId: string }, { success: boolean; metadata: CycleReportMetadata }>(
      functions,
      'adminGenerateRetrospectiveReportCallable'
    );
    const res = await callable({ cycleId });
    if (!res.data.success || !res.data.metadata) {
      throw new Error('No se pudo generar el informe retrospectivo.');
    }
    return res.data.metadata;
  }

  /**
   * Solicita al backend la compilación en caliente del PDF y activa la descarga segura en el navegador.
   * El PDF nunca se guarda permanentemente.
   */
  public async downloadCycleReportPdf(
    cycleId: string,
    versionId: string
  ): Promise<{ filename: string; blobUrl: string }> {
    const callable = httpsCallable<
      { cycleId: string; versionId: string },
      { success: boolean; pdfBase64: string; filename: string; metadata: CycleReportMetadata }
    >(functions, 'adminGenerateCycleReportPdfCallable');

    const res = await callable({ cycleId, versionId });
    if (!res.data.success || !res.data.pdfBase64) {
      throw new Error('El backend no retornó los datos del PDF generado.');
    }

    const { pdfBase64, filename } = res.data;

    // Convertir Base64 a ArrayBuffer / Uint8Array
    const binaryString = window.atob(pdfBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Crear Blob en memoria
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const blobUrl = window.URL.createObjectURL(blob);

    // Disparar descarga directa en el navegador
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || `Informe_Cierre_${cycleId}_${versionId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Liberar URL después de un breve delay
    setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
    }, 60000);

    return { filename, blobUrl };
  }
}

export const cycleReportService = new CycleReportService();
