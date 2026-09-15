/**
 * ============================================================================
 * VISOR DE INFORMES OFICIALES DE CIERRE POR CICLO (EXCLUSIVO SUPERADMIN)
 * ============================================================================
 * Visualización ejecutiva de snapshots inmutables y compilación de PDF bajo demanda.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Download,
  ShieldCheck,
  History,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  Calendar,
  DollarSign,
  TrendingUp,
  Users,
  Layers,
  CheckCircle2,
  Lock,
  ArrowLeft,
  ChevronRight,
  Printer,
  Sparkles,
  Info,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cycleReportService, CycleReportItem } from '../lib/cycleReportService';
import { CycleReportMetadata, CycleReportUserSnapshot, BitacoraCategory } from '../types';
import { formatCOP, formatUSD } from '../lib/financialEngine';

export const CycleReportViewer: React.FC = () => {
  const { isSuperAdmin, currentUser } = useAuth();

  // Estados de lista y selección
  const [closedCycles, setClosedCycles] = useState<CycleReportItem[]>([]);
  const [loadingCycles, setLoadingCycles] = useState<boolean>(true);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);

  // Estados del informe seleccionado
  const [versions, setVersions] = useState<CycleReportMetadata[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [currentMetadata, setCurrentMetadata] = useState<CycleReportMetadata | null>(null);
  const [userSnapshots, setUserSnapshots] = useState<CycleReportUserSnapshot[]>([]);
  const [loadingDetails, setLoadingDetails] = useState<boolean>(false);

  // Estados de acciones
  const [generatingPdf, setGeneratingPdf] = useState<boolean>(false);
  const [generatingRetro, setGeneratingRetro] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showVersionsModal, setShowVersionsModal] = useState<boolean>(false);

  // Filtros de tabla
  const [activeBitacoraTab, setActiveBitacoraTab] = useState<'RESUMEN' | 'AZUL' | 'VERDE' | 'NEGRA' | 'TODOS'>('RESUMEN');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [modalityFilter, setModalityFilter] = useState<'ALL' | 'PROFIT_REINVESTMENT' | 'CAPITAL_INJECTION' | 'NONE'>('ALL');

  // 1. Cargar ciclos cerrados al montar
  const loadClosedCycles = async () => {
    setLoadingCycles(true);
    setActionMessage(null);
    try {
      const items = await cycleReportService.getClosedCyclesWithReportStatus();
      setClosedCycles(items);
      if (items.length > 0 && !selectedCycleId) {
        setSelectedCycleId(items[0].cycleId);
      }
    } catch (err: any) {
      console.error('Error cargando ciclos cerrados:', err);
      setActionMessage({ type: 'error', text: 'No se pudieron cargar los ciclos cerrados: ' + (err.message || String(err)) });
    } finally {
      setLoadingCycles(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      loadClosedCycles();
    }
  }, [isSuperAdmin]);

  // 2. Cargar versiones cuando cambia el ciclo seleccionado
  useEffect(() => {
    if (!selectedCycleId || !isSuperAdmin) return;

    let isMounted = true;
    const fetchVersions = async () => {
      setLoadingDetails(true);
      setActionMessage(null);
      try {
        const vList = await cycleReportService.getCycleReportVersions(selectedCycleId);
        if (!isMounted) return;
        setVersions(vList);

        if (vList.length > 0) {
          // Seleccionar versión vigente o la primera
          const current = vList.find((v) => v.isCurrent) || vList[0];
          setSelectedVersionId(current.versionId);
        } else {
          setSelectedVersionId(null);
          setCurrentMetadata(null);
          setUserSnapshots([]);
        }
      } catch (err: any) {
        console.error('Error cargando versiones:', err);
        if (isMounted) {
          setActionMessage({ type: 'error', text: 'Error al consultar versiones del ciclo: ' + err.message });
        }
      } finally {
        if (isMounted) setLoadingDetails(false);
      }
    };

    fetchVersions();
    return () => {
      isMounted = false;
    };
  }, [selectedCycleId, isSuperAdmin]);

  // 3. Cargar detalles del snapshot cuando cambia la versión
  useEffect(() => {
    if (!selectedCycleId || !selectedVersionId || !isSuperAdmin) return;

    let isMounted = true;
    const fetchDetails = async () => {
      setLoadingDetails(true);
      try {
        const { metadata, users } = await cycleReportService.getCycleReportDetails(selectedCycleId, selectedVersionId);
        if (!isMounted) return;
        setCurrentMetadata(metadata);
        setUserSnapshots(users);
      } catch (err: any) {
        console.error('Error cargando snapshot:', err);
        if (isMounted) {
          setActionMessage({ type: 'error', text: 'Error al cargar datos congelados de la versión: ' + err.message });
        }
      } finally {
        if (isMounted) setLoadingDetails(false);
      }
    };

    fetchDetails();
    return () => {
      isMounted = false;
    };
  }, [selectedCycleId, selectedVersionId, isSuperAdmin]);

  // Manejo de generación de PDF bajo demanda
  const handleDownloadPdf = async () => {
    if (!selectedCycleId || !selectedVersionId) return;
    setGeneratingPdf(true);
    setActionMessage(null);
    try {
      const result = await cycleReportService.downloadCycleReportPdf(selectedCycleId, selectedVersionId);
      setActionMessage({
        type: 'success',
        text: `PDF generado exitosamente (${result.filename}). La descarga inició automáticamente.`,
      });
    } catch (err: any) {
      console.error('Error generando PDF:', err);
      setActionMessage({ type: 'error', text: 'Error al compilar el PDF: ' + (err.message || String(err)) });
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Manejo de generación retrospectiva
  const handleGenerateRetro = async () => {
    if (!selectedCycleId) return;
    if (!window.confirm(`¿Confirmas generar un informe oficial retrospectivo para el ciclo ${selectedCycleId}? Esto congelará los resultados registrados en su cierre.`)) {
      return;
    }
    setGeneratingRetro(true);
    setActionMessage(null);
    try {
      const meta = await cycleReportService.generateRetrospectiveReport(selectedCycleId);
      setActionMessage({
        type: 'success',
        text: `Informe retrospectivo creado exitosamente para ${selectedCycleId} (${meta.versionId}).`,
      });
      // Recargar lista y versiones
      await loadClosedCycles();
      const vList = await cycleReportService.getCycleReportVersions(selectedCycleId);
      setVersions(vList);
      if (vList.length > 0) {
        setSelectedVersionId(vList[0].versionId);
      }
    } catch (err: any) {
      console.error('Error generando informe retrospectivo:', err);
      setActionMessage({ type: 'error', text: 'Error al crear informe retrospectivo: ' + (err.message || String(err)) });
    } finally {
      setGeneratingRetro(false);
    }
  };

  // Filtrado de usuarios congelados
  const filteredUsers = useMemo(() => {
    return userSnapshots.filter((u) => {
      // Filtro por bitácora
      if (activeBitacoraTab !== 'TODOS' && activeBitacoraTab !== 'RESUMEN') {
        if (u.cycleCategory !== activeBitacoraTab) return false;
      }

      // Filtro por modalidad
      if (modalityFilter !== 'ALL') {
        if (u.reinvestmentModality !== modalityFilter) return false;
      }

      // Filtro por texto
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const codeMatch = (u.userCode || '').toLowerCase().includes(q);
        const nameMatch = (u.userNameSnapshot || '').toLowerCase().includes(q);
        if (!codeMatch && !nameMatch) return false;
      }

      return true;
    });
  }, [userSnapshots, activeBitacoraTab, modalityFilter, searchTerm]);

  // SEGURIDAD ZERO-TRUST: Si no es SuperAdmin, bloquear con pantalla explícita
  if (!isSuperAdmin) {
    return (
      <div className="w-full min-h-[450px] flex flex-col items-center justify-center p-8 bg-slate-900/60 border border-red-500/30 rounded-2xl text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4 text-red-400">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">Acceso Restringido — Exclusivo SuperAdmin</h3>
        <p className="text-sm text-slate-400 max-w-md mb-4">
          El módulo de Informes Oficiales de Cierre contiene snapshots financieros inmutables y compilación de actas oficiales. Solo el SuperAdmin tiene privilegios de auditoría y descarga.
        </p>
        <span className="text-xs font-mono text-slate-500 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
          UID Actual: {currentUser?.uid || 'No autenticado'} • Privilegio: Denegado
        </span>
      </div>
    );
  }

  const selectedCycleItem = closedCycles.find((c) => c.cycleId === selectedCycleId);

  return (
    <div className="w-full space-y-6">
      {/* Banner de Mensajes / Notificaciones */}
      {actionMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-sm transition-all ${
            actionMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-xs font-semibold underline hover:opacity-80 ml-4 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Selector Superior de Ciclos Cerrados */}
      <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-bold tracking-wider uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                AUDITORÍA SUPERADMIN
              </span>
              <span className="text-xs text-slate-400">Snapshots Inmutables & Actas Oficiales</span>
            </div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-500" />
              Informes Oficiales de Cierre Mensual
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Selector de Ciclo */}
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-400 font-medium">Ciclo:</span>
              <select
                value={selectedCycleId || ''}
                onChange={(e) => setSelectedCycleId(e.target.value)}
                disabled={loadingCycles}
                className="bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer"
              >
                {closedCycles.map((c) => (
                  <option key={c.cycleId} value={c.cycleId} className="bg-slate-900 text-white">
                    {c.cycleName} {c.hasReport ? `(Informe v${c.currentVersionNumber || 1})` : '(Sin snapshot)'}
                  </option>
                ))}
              </select>
            </div>

            {/* Selector de Versión (si hay varias) */}
            {versions.length > 0 && (
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
                <History className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-400 font-medium">Versión:</span>
                <select
                  value={selectedVersionId || ''}
                  onChange={(e) => setSelectedVersionId(e.target.value)}
                  disabled={loadingDetails}
                  className="bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer"
                >
                  {versions.map((v) => (
                    <option key={v.versionId} value={v.versionId} className="bg-slate-900 text-white">
                      {v.versionId} {v.isCurrent ? '★ OFICIAL VIGENTE' : '• HISTÓRICO (SUPERSEDED)'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Botón Ver Historial de Versiones */}
            {versions.length > 1 && (
              <button
                onClick={() => setShowVersionsModal(true)}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 transition cursor-pointer border border-slate-700"
              >
                <History className="w-3.5 h-3.5" />
                Versiones ({versions.length})
              </button>
            )}

            {/* Botón Descargar PDF */}
            {currentMetadata && currentMetadata.status === 'READY' && (
              <button
                onClick={handleDownloadPdf}
                disabled={generatingPdf}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 flex items-center gap-2 transition shadow-lg shadow-amber-500/20 cursor-pointer disabled:opacity-50"
              >
                {generatingPdf ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Compilando PDF...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Generar PDF Oficial</span>
                  </>
                )}
              </button>
            )}

            {/* Si no hay informe, permitir generar retrospectivo */}
            {selectedCycleItem && !selectedCycleItem.hasReport && (
              <button
                onClick={handleGenerateRetro}
                disabled={generatingRetro}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2 transition shadow-lg shadow-blue-600/20 cursor-pointer disabled:opacity-50"
              >
                {generatingRetro ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Generando...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Generar Snapshot Retrospectivo</span>
                  </>
                )}
              </button>
            )}

            <button
              onClick={loadClosedCycles}
              disabled={loadingCycles}
              title="Refrescar lista"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer border border-slate-700"
            >
              <RefreshCw className={`w-4 h-4 ${loadingCycles ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Badges de Estado de la versión seleccionada */}
        {currentMetadata && (
          <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
            {currentMetadata.isCurrent ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                VERSIÓN OFICIAL VIGENTE ({currentMetadata.versionId})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-400">
                <Clock className="w-3.5 h-3.5" />
                VERSIÓN HISTÓRICA SUPERSEDED ({currentMetadata.versionId})
              </span>
            )}

            {currentMetadata.isRetrospective && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-500/10 border border-blue-500/30 text-blue-400">
                <Sparkles className="w-3 h-3" />
                Snapshot Retrospectivo
              </span>
            )}

            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-slate-300">
              TRM Aplicada: <strong className="text-amber-400 ml-1">{formatCOP(currentMetadata.trmApplied)}</strong>
            </span>

            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-slate-300">
              Reconciliación: <strong className="text-emerald-400 ml-1">{currentMetadata.reconciliationStatus || 'PASSED'}</strong>
            </span>

            <span className="text-xs text-slate-500 ml-auto">
              Congelado el: {new Date(currentMetadata.snapshotGeneratedAt || currentMetadata.closedAt).toLocaleString('es-CO')}
            </span>
          </div>
        )}
      </div>

      {/* Caso: No hay ciclo cerrado seleccionado o cargando */}
      {loadingCycles && (
        <div className="w-full py-16 flex flex-col items-center justify-center text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin text-amber-500 mb-3" />
          <p className="text-sm font-medium">Consultando ciclos cerrados y snapshots inmutables...</p>
        </div>
      )}

      {!loadingCycles && closedCycles.length === 0 && (
        <div className="w-full py-16 bg-slate-900/40 border border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center p-6">
          <Calendar className="w-10 h-10 text-slate-600 mb-3" />
          <h3 className="text-lg font-bold text-white mb-1">No hay ciclos cerrados</h3>
          <p className="text-sm text-slate-400 max-w-md">
            Los informes oficiales de cierre se generan automáticamente cuando el SuperAdmin concluye un ciclo operativo mediante el proceso atómico de cierre mensual.
          </p>
        </div>
      )}

      {/* Caso: Ciclo cerrado pero sin informe */}
      {!loadingCycles && selectedCycleItem && !selectedCycleItem.hasReport && (
        <div className="w-full py-12 bg-slate-900/40 border border-amber-500/20 rounded-2xl flex flex-col items-center justify-center text-center p-6">
          <AlertCircle className="w-10 h-10 text-amber-500 mb-3" />
          <h3 className="text-lg font-bold text-white mb-1">Sin Snapshot Inmutable para {selectedCycleItem.cycleName}</h3>
          <p className="text-sm text-slate-400 max-w-md mb-5">
            Este ciclo fue cerrado con anterioridad a la activación del sistema de informes inmutables. Puede compilar un snapshot retrospectivo oficial auditando los resultados de liquidación existentes.
          </p>
          <button
            onClick={handleGenerateRetro}
            disabled={generatingRetro}
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center gap-2 transition shadow-lg shadow-amber-500/20 cursor-pointer disabled:opacity-50"
          >
            {generatingRetro ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Generando snapshot...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Compilar Snapshot Retrospectivo Ahora</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Contenido Completo del Informe */}
      {currentMetadata && (
        <>
          {/* Tarjetas de KPI del Consolidado Global */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] font-medium text-slate-400 block mb-1">Capital Operado</span>
              <span className="text-base lg:text-lg font-bold text-white block">
                {formatCOP(currentMetadata.totalManagedCapital)}
              </span>
              <span className="text-[10px] text-slate-500 mt-1 block">{currentMetadata.totalUsers} inversionistas</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] font-medium text-slate-400 block mb-1">Total USD Operado</span>
              <span className="text-base lg:text-lg font-bold text-blue-400 block">
                {formatUSD(currentMetadata.totalUsdOperated)}
              </span>
              <span className="text-[10px] text-slate-500 mt-1 block">Trading acumulado</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] font-medium text-slate-400 block mb-1">Ganancia Bruta COP</span>
              <span className="text-base lg:text-lg font-bold text-emerald-400 block">
                {formatCOP(currentMetadata.totalGrossCop)}
              </span>
              <span className="text-[10px] text-slate-500 mt-1 block">A TRM aplicada</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] font-medium text-slate-400 block mb-1">Ganancia Inversionistas</span>
              <span className="text-base lg:text-lg font-bold text-teal-400 block">
                {formatCOP(currentMetadata.totalUsersProfitCop)}
              </span>
              <span className="text-[10px] text-teal-500/70 mt-1 block">Rendimiento clientes</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] font-medium text-slate-400 block mb-1">Comisión Administración</span>
              <span className="text-base lg:text-lg font-bold text-purple-400 block">
                {formatCOP(currentMetadata.totalAdminCommissionCop)}
              </span>
              <span className="text-[10px] text-purple-400/70 mt-1 block">Ingreso empresa</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] font-medium text-slate-400 block mb-1">Utilidad Reinvertida</span>
              <span className="text-base lg:text-lg font-bold text-sky-400 block">
                {formatCOP(currentMetadata.totalReinvestedProfitCop)}
              </span>
              <span className="text-[10px] text-slate-500 mt-1 block">Estado APPLIED</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] font-medium text-slate-400 block mb-1">Inyección Externa</span>
              <span className="text-base lg:text-lg font-bold text-cyan-400 block">
                {formatCOP(currentMetadata.totalCashInjectionCop)}
              </span>
              <span className="text-[10px] text-slate-500 mt-1 block">Capital nuevo sumado</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <span className="text-[11px] font-medium text-slate-400 block mb-1">Total a Desembolsar</span>
              <span className="text-base lg:text-lg font-bold text-amber-400 block">
                {formatCOP(currentMetadata.totalDisbursementCop)}
              </span>
              <span className="text-[10px] text-amber-500/70 mt-1 block">Retiro efectivo/banco</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 col-span-2 md:col-span-2">
              <span className="text-[11px] font-medium text-slate-400 block mb-1">Incremento Total de Capital</span>
              <span className="text-base lg:text-lg font-bold text-emerald-300 block">
                {formatCOP(currentMetadata.totalCapitalIncreaseCop)}
              </span>
              <span className="text-[10px] text-slate-500 mt-1 block">Reinvertido + Inyección aplicada</span>
            </div>
          </div>

          {/* Selector de Pestañas de Vista */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setActiveBitacoraTab('RESUMEN')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    activeBitacoraTab === 'RESUMEN'
                      ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Resumen por Bitácora
                </button>
                <button
                  onClick={() => setActiveBitacoraTab('AZUL')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    activeBitacoraTab === 'AZUL'
                      ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  Bitácora Azul ({currentMetadata.bitacoras?.AZUL?.usersCount || 0})
                </button>
                <button
                  onClick={() => setActiveBitacoraTab('VERDE')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    activeBitacoraTab === 'VERDE'
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Bitácora Verde ({currentMetadata.bitacoras?.VERDE?.usersCount || 0})
                </button>
                <button
                  onClick={() => setActiveBitacoraTab('NEGRA')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    activeBitacoraTab === 'NEGRA'
                      ? 'bg-slate-200 text-slate-950 shadow-md shadow-white/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  Bitácora Negra ({currentMetadata.bitacoras?.NEGRA?.usersCount || 0})
                </button>
                <button
                  onClick={() => setActiveBitacoraTab('TODOS')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    activeBitacoraTab === 'TODOS'
                      ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  Todos los Inversionistas ({userSnapshots.length})
                </button>
              </div>

              {/* Buscador y Filtro si estamos en vista de usuarios */}
              {activeBitacoraTab !== 'RESUMEN' && (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar código o nombre..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="bg-slate-950 border border-slate-800 text-xs text-white rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:border-amber-500 w-44 lg:w-56"
                    />
                  </div>

                  <select
                    value={modalityFilter}
                    onChange={(e: any) => setModalityFilter(e.target.value)}
                    className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer"
                  >
                    <option value="ALL">Todas las modalidades</option>
                    <option value="PROFIT_REINVESTMENT">Solo Reinversión</option>
                    <option value="CAPITAL_INJECTION">Solo Inyección</option>
                    <option value="NONE">Sin reinversión</option>
                  </select>
                </div>
              )}
            </div>

            {/* TAB: Resumen por Bitácora */}
            {activeBitacoraTab === 'RESUMEN' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="text-[11px] uppercase tracking-wider bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Bitácora</th>
                      <th className="py-3 px-3 text-center">Usuarios</th>
                      <th className="py-3 px-4 text-right">Capital Operado</th>
                      <th className="py-3 px-4 text-right">USD Operado</th>
                      <th className="py-3 px-4 text-right">Ganancia Bruta</th>
                      <th className="py-3 px-4 text-right text-emerald-400">Ganancia Inversionistas</th>
                      <th className="py-3 px-4 text-right text-purple-400">Comisión Admin</th>
                      <th className="py-3 px-4 text-right">Reinvertido</th>
                      <th className="py-3 px-4 text-right">Inyección</th>
                      <th className="py-3 px-4 text-right text-amber-400">Desembolso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {/* AZUL */}
                    <tr className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                        <span className="font-bold text-sky-400">AZUL</span>
                      </td>
                      <td className="py-3 px-3 text-center">{currentMetadata.bitacoras?.AZUL?.usersCount || 0}</td>
                      <td className="py-3 px-4 text-right font-bold text-white">
                        {formatCOP(currentMetadata.bitacoras?.AZUL?.managedCapitalCop)}
                      </td>
                      <td className="py-3 px-4 text-right text-blue-400">
                        {formatUSD(currentMetadata.bitacoras?.AZUL?.totalUsdOperated)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {formatCOP(currentMetadata.bitacoras?.AZUL?.grossProfitCop)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-400">
                        {formatCOP(currentMetadata.bitacoras?.AZUL?.userProfitCop)}
                      </td>
                      <td className="py-3 px-4 text-right text-purple-400">
                        {formatCOP(currentMetadata.bitacoras?.AZUL?.adminCommissionCop)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {formatCOP(currentMetadata.bitacoras?.AZUL?.reinvestedProfitCop)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {formatCOP(currentMetadata.bitacoras?.AZUL?.cashInjectionCop)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-amber-400">
                        {formatCOP(currentMetadata.bitacoras?.AZUL?.disbursementCop)}
                      </td>
                    </tr>

                    {/* VERDE */}
                    <tr className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                        <span className="font-bold text-emerald-400">VERDE</span>
                      </td>
                      <td className="py-3 px-3 text-center">{currentMetadata.bitacoras?.VERDE?.usersCount || 0}</td>
                      <td className="py-3 px-4 text-right font-bold text-white">
                        {formatCOP(currentMetadata.bitacoras?.VERDE?.managedCapitalCop)}
                      </td>
                      <td className="py-3 px-4 text-right text-blue-400">
                        {formatUSD(currentMetadata.bitacoras?.VERDE?.totalUsdOperated)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {formatCOP(currentMetadata.bitacoras?.VERDE?.grossProfitCop)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-400">
                        {formatCOP(currentMetadata.bitacoras?.VERDE?.userProfitCop)}
                      </td>
                      <td className="py-3 px-4 text-right text-purple-400">
                        {formatCOP(currentMetadata.bitacoras?.VERDE?.adminCommissionCop)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {formatCOP(currentMetadata.bitacoras?.VERDE?.reinvestedProfitCop)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {formatCOP(currentMetadata.bitacoras?.VERDE?.cashInjectionCop)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-amber-400">
                        {formatCOP(currentMetadata.bitacoras?.VERDE?.disbursementCop)}
                      </td>
                    </tr>

                    {/* NEGRA */}
                    <tr className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                        <span className="font-bold text-slate-300">NEGRA</span>
                      </td>
                      <td className="py-3 px-3 text-center">{currentMetadata.bitacoras?.NEGRA?.usersCount || 0}</td>
                      <td className="py-3 px-4 text-right font-bold text-white">
                        {formatCOP(currentMetadata.bitacoras?.NEGRA?.managedCapitalCop)}
                      </td>
                      <td className="py-3 px-4 text-right text-blue-400">
                        {formatUSD(currentMetadata.bitacoras?.NEGRA?.totalUsdOperated)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {formatCOP(currentMetadata.bitacoras?.NEGRA?.grossProfitCop)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-400">
                        {formatCOP(currentMetadata.bitacoras?.NEGRA?.userProfitCop)}
                      </td>
                      <td className="py-3 px-4 text-right text-purple-400">
                        {formatCOP(currentMetadata.bitacoras?.NEGRA?.adminCommissionCop)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {formatCOP(currentMetadata.bitacoras?.NEGRA?.reinvestedProfitCop)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {formatCOP(currentMetadata.bitacoras?.NEGRA?.cashInjectionCop)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-amber-400">
                        {formatCOP(currentMetadata.bitacoras?.NEGRA?.disbursementCop)}
                      </td>
                    </tr>

                    {/* TOTAL CONSOLIDADO */}
                    <tr className="bg-slate-950 font-bold text-white border-t-2 border-slate-700">
                      <td className="py-3 px-4 text-amber-400">TOTAL CONSOLIDADO</td>
                      <td className="py-3 px-3 text-center">{currentMetadata.totalUsers}</td>
                      <td className="py-3 px-4 text-right">{formatCOP(currentMetadata.totalManagedCapital)}</td>
                      <td className="py-3 px-4 text-right text-blue-400">{formatUSD(currentMetadata.totalUsdOperated)}</td>
                      <td className="py-3 px-4 text-right">{formatCOP(currentMetadata.totalGrossCop)}</td>
                      <td className="py-3 px-4 text-right text-emerald-400">{formatCOP(currentMetadata.totalUsersProfitCop)}</td>
                      <td className="py-3 px-4 text-right text-purple-400">{formatCOP(currentMetadata.totalAdminCommissionCop)}</td>
                      <td className="py-3 px-4 text-right">{formatCOP(currentMetadata.totalReinvestedProfitCop)}</td>
                      <td className="py-3 px-4 text-right">{formatCOP(currentMetadata.totalCashInjectionCop)}</td>
                      <td className="py-3 px-4 text-right text-amber-400">{formatCOP(currentMetadata.totalDisbursementCop)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB: Listado Detallado de Usuarios (Azul, Verde, Negra o Todos) */}
            {activeBitacoraTab !== 'RESUMEN' && (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="text-[10px] uppercase tracking-wider bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Código</th>
                      <th className="py-2.5 px-3">Inversionista</th>
                      {activeBitacoraTab === 'TODOS' && <th className="py-2.5 px-2 text-center">Bitácora</th>}
                      <th className="py-2.5 px-3 text-right">Capital Op.</th>
                      <th className="py-2.5 px-2 text-center">Split</th>
                      <th className="py-2.5 px-3 text-right">USD Op.</th>
                      <th className="py-2.5 px-3 text-right">Gan. Bruta</th>
                      <th className="py-2.5 px-3 text-right text-emerald-400">Gan. Usuario</th>
                      <th className="py-2.5 px-3 text-right text-purple-400">Com. Admin</th>
                      <th className="py-2.5 px-2 text-center">Modalidad</th>
                      <th className="py-2.5 px-3 text-right">Reinvertido</th>
                      <th className="py-2.5 px-3 text-right">Inyección</th>
                      <th className="py-2.5 px-3 text-right text-amber-400">Desembolso</th>
                      <th className="py-2.5 px-3 text-right font-bold text-white">Capital Final</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="py-8 text-center text-slate-500 font-sans">
                          No se encontraron inversionistas con los filtros seleccionados.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u, idx) => (
                        <tr key={u.userUid || idx} className="hover:bg-slate-850 transition">
                          <td className="py-2 px-3 font-bold text-white font-sans">{u.userCode}</td>
                          <td className="py-2 px-3 font-sans truncate max-w-[140px]" title={u.userNameSnapshot}>
                            {u.userNameSnapshot}
                          </td>
                          {activeBitacoraTab === 'TODOS' && (
                            <td className="py-2 px-2 text-center">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  u.cycleCategory === 'AZUL'
                                    ? 'bg-sky-500/20 text-sky-400'
                                    : u.cycleCategory === 'VERDE'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-slate-700 text-slate-300'
                                }`}
                              >
                                {u.cycleCategory}
                              </span>
                            </td>
                          )}
                          <td className="py-2 px-3 text-right">{formatCOP(u.cycleCapitalCop)}</td>
                          <td className="py-2 px-2 text-center text-[10px] text-slate-400 font-sans">
                            {u.userPercentage}/{u.adminPercentage}
                          </td>
                          <td className="py-2 px-3 text-right text-blue-400">{formatUSD(u.totalUsdOperated)}</td>
                          <td className="py-2 px-3 text-right">{formatCOP(u.totalGrossCop)}</td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-400">
                            {formatCOP(u.userProfitCop)}
                          </td>
                          <td className="py-2 px-3 text-right text-purple-400">
                            {formatCOP(u.adminCommissionCop)}
                          </td>
                          <td className="py-2 px-2 text-center font-sans text-[10px]">
                            {u.reinvestmentModality === 'CAPITAL_INJECTION' ? (
                              <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                                INYECCIÓN
                              </span>
                            ) : u.reinvestmentModality === 'PROFIT_REINVESTMENT' ? (
                              <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold">
                                REINVERSIÓN
                              </span>
                            ) : (
                              <span className="text-slate-600">-</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right text-sky-400">
                            {u.profitAppliedCop > 0 ? formatCOP(u.profitAppliedCop) : '-'}
                          </td>
                          <td className="py-2 px-3 text-right text-cyan-400">
                            {u.cashInjectionCop > 0 ? formatCOP(u.cashInjectionCop) : '-'}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-amber-400">
                            {u.profitToDisburseCop > 0 ? formatCOP(u.profitToDisburseCop) : '-'}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-white font-sans">
                            {formatCOP(u.finalCapitalAfterCloseCop)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sello de Inmutabilidad y Auditoría */}
          <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-slate-400 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-white block">Certificación de Inmutabilidad Legal y Operativa:</span>
              <p>
                Los valores financieros expuestos en esta pantalla y en el documento PDF oficial corresponden al snapshot congelado en el momento exacto del cierre. No sufren alteraciones ante cambios futuros en saldos de usuarios ni ante mutaciones de TRM posteriores. Cualquier reapertura autorizada de ciclo invalida la vigencia de este reporte marcándolo como SUPERSEDED y originando una nueva versión numerada.
              </p>
              <div className="text-[10px] text-slate-500 font-mono pt-1">
                ID Cierre: {currentMetadata.closureAttemptId || 'N/D'} • Generado por: {currentMetadata.closedByName || 'SuperAdmin'} ({currentMetadata.closedByUid || 'N/D'})
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal de Historial de Versiones */}
      {showVersionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-amber-500" />
                Historial de Versiones — {selectedCycleItem?.cycleName}
              </h3>
              <button
                onClick={() => setShowVersionsModal(false)}
                className="text-slate-400 hover:text-white text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {versions.map((v) => (
                <div
                  key={v.versionId}
                  onClick={() => {
                    setSelectedVersionId(v.versionId);
                    setShowVersionsModal(false);
                  }}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    v.versionId === selectedVersionId
                      ? 'bg-amber-500/10 border-amber-500/40'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm text-white">Versión {v.versionId}</span>
                    {v.isCurrent ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        OFICIAL VIGENTE
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                        SUPERSEDED
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <span>TRM: </span>
                      <strong className="text-amber-400">{formatCOP(v.trmApplied)}</strong>
                    </div>
                    <div>
                      <span>Inversionistas: </span>
                      <strong className="text-white">{v.totalUsers}</strong>
                    </div>
                    <div>
                      <span>Capital Total: </span>
                      <strong className="text-white">{formatCOP(v.totalManagedCapital)}</strong>
                    </div>
                    <div>
                      <span>Fecha: </span>
                      <span>{new Date(v.snapshotGeneratedAt || v.closedAt).toLocaleDateString('es-CO')}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowVersionsModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
