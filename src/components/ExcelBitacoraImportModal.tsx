import React, { useState, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  UserPlus,
  Users,
  DollarSign,
  TrendingUp,
  X,
  Trash2,
  Sparkles,
  Info,
  Layers,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { BitacoraCategory, ImportedBitacoraRow, MonthlyCycle } from '../types';
import {
  parseExcelBitacoraFile,
  downloadSampleBitacoraExcel,
} from '../lib/excelMigrationService';
import { dataStore } from '../lib/dataStore';
import { firestoreService } from '../lib/firestoreService';
import { useAuth } from '../context/AuthContext';

interface ExcelBitacoraImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  cycle?: MonthlyCycle;
  defaultCategory?: BitacoraCategory;
  defaultCycleId?: string;
  adminUid?: string;
  adminName?: string;
  onSuccess?: () => void;
  onImportSuccess?: () => void;
}

export const ExcelBitacoraImportModal: React.FC<ExcelBitacoraImportModalProps> = ({
  isOpen,
  onClose,
  cycle,
  defaultCategory,
  defaultCycleId,
  onSuccess,
  onImportSuccess,
}) => {
  const { currentUser } = useAuth();
  const currentAuthUser = currentUser;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [rows, setRows] = useState<ImportedBitacoraRow[]>([]);
  const [targetCategory, setTargetCategory] = useState<BitacoraCategory | 'ALL'>(
    defaultCategory || 'ALL'
  );

  const cycles = dataStore.getCycles();
  const activeCycle = dataStore.getActiveCycle();
  const globalConfig = dataStore.getConfig();
  const preparingCycleId =
    String(globalConfig.preparingCycleId || '').trim();

  const preparingCycle =
    cycles.find(
      (c) =>
        (c.cycleId === preparingCycleId ||
          c.id === preparingCycleId) &&
        c.status === 'OPEN' &&
        c.operationalStatus === 'PREPARING'
    ) || null;

  const [selectedCycleId, setSelectedCycleId] =
    useState<string>(
      preparingCycleId
    );

  const [autoCreateUsers, setAutoCreateUsers] = useState<boolean>(true);
  const [updateExistingCapital, setUpdateExistingCapital] = useState<boolean>(true);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = async (selectedFile: File) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setIsParsing(true);
    setParseErrors([]);
    setImportSuccessMessage(null);

    try {
      const existingUsers = dataStore.getUsers();
      const forceCat = targetCategory === 'ALL' ? undefined : targetCategory;
      const result = await parseExcelBitacoraFile(selectedFile, existingUsers, forceCat);

      // El ciclo detectado dentro del Excel es solo
      // metadata historica. Nunca puede seleccionar
      // el ciclo financiero autoritativo.
      setSelectedCycleId(
        String(
          globalConfig.preparingCycleId || ''
        ).trim()
      );

      setRows(result.rows);
      setParseErrors(result.errors);
    } catch (err: any) {
      setParseErrors([err.message || 'Error al procesar el archivo Excel.']);
      setRows([]);
    } finally {
      setIsParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleRemoveRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.rawId !== id));
  };

  const handleRowChange = (id: string, field: keyof ImportedBitacoraRow, value: any) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rawId !== id) return r;
        const updated = { ...r, [field]: value };
        if (field === 'capitalCop') {
          const cap = Number(value) || 0;
          if (cap >= 60000000) {
            updated.category = 'NEGRA';
          } else if (cap >= 10000000) {
            updated.category = 'VERDE';
          } else {
            updated.category = 'AZUL';
          }
        }
        return updated;
      })
    );
  };

  const handleImport = async () => {
    if (rows.length === 0) return;

    setImportSuccessMessage(null);
    setParseErrors([]);
    setIsImporting(true);

    try {
      const latestConfig =
        dataStore.getConfig();

      const authoritativePreparingCycleId =
        String(
          latestConfig.preparingCycleId || ''
        ).trim();

      if (!authoritativePreparingCycleId) {
        throw new Error(
          'No existe un ciclo PREPARING autoritativo. ' +
          'Crea o prepara el siguiente ciclo antes de importar inversionistas.'
        );
      }

      const targetCycle =
        dataStore
          .getCycles()
          .find(
            (c) =>
              (
                c.cycleId ===
                  authoritativePreparingCycleId ||
                c.id ===
                  authoritativePreparingCycleId
              )
          );

      if (
        !targetCycle ||
        targetCycle.status !== 'OPEN' ||
        targetCycle.operationalStatus !==
          'PREPARING'
      ) {
        throw new Error(
          'El ciclo de ingreso no esta disponible ' +
          'en estado OPEN + PREPARING.'
        );
      }

      setSelectedCycleId(
        authoritativePreparingCycleId
      );

      const requestRows =
        rows.map(
          (row, index) => {
            const raw =
              row as any;

            // Regla fija del negocio:
            // 50% inversionista / 50% administracion.
            const userPercentage = 50;

            return {
              rawId:
                String(
                  raw.rawId ??
                  raw.id ??
                  index + 1
                ),

              clientName:
                String(
                  raw.clientName || ''
                ).trim(),

              fullName:
                String(
                  raw.clientName ||
                  raw.fullName ||
                  ''
                ).trim(),

              email:
                String(
                  raw.email || ''
                ).trim(),

              phone:
                String(
                  raw.phone || ''
                ).trim(),

              capitalCop:
                Number(
                  raw.capitalCop
                ) || 0,

              currentCapital:
                Number(
                  raw.capitalCop
                ) || 0,

              matchedUserCode:
                String(
                  raw.matchedUserCode || ''
                ).trim(),

              userPercentage: 50,

              adminPercentage: 50,

              paymentMethod:
                String(
                  raw.paymentMethod || ''
                ).trim(),

              paymentDetails:
                String(
                  raw.paymentDetails || ''
                ).trim(),
            };
          }
        );

      const clientRequestId =
        (
          globalThis.crypto &&
          typeof globalThis.crypto.randomUUID ===
            'function'
        )
          ? globalThis.crypto.randomUUID()
          : (
              'excel_' +
              Date.now().toString(36) +
              '_' +
              Math.random()
                .toString(36)
                .slice(2)
            );

      const result =
        await firestoreService
          .adminBulkImportInvestors({
            targetCycleId:
              authoritativePreparingCycleId,

            clientRequestId,

            rows:
              requestRows,
          });

      const issues =
        result.results
          .filter(
            (item) =>
              item.status !== 'CREATED'
          )
          .map(
            (item) => {
              const name =
                item.fullName ||
                `Fila ${item.index + 1}`;

              return (
                `${name}: ` +
                `${item.message || item.code}`
              );
            }
          );

      if (issues.length > 0) {
        setParseErrors(
          issues.slice(0, 50)
        );
      }

      setImportSuccessMessage(
        '\u00a1Importaci\u00f3n procesada por el servidor! ' +
        `${result.createdUsersCount} creados, ` +
        `${result.skippedUsersCount} omitidos y ` +
        `${result.failedUsersCount} con error. ` +
        `Ciclo PREPARING: ${result.targetCycleId}.`
      );

      try {
        confetti({
          particleCount:
            result.createdUsersCount > 0
              ? 80
              : 20,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch {
        // Confetti es opcional.
      }

      // Firestore listener actualizara allUsers.
      // No insertamos usuarios ficticios en memoria.
      setTimeout(() => {
        if (onSuccess) {
          onSuccess();
        }

        if (onImportSuccess) {
          onImportSuccess();
        }
      }, 500);

    } catch (err: any) {
      console.error(
        '[ExcelBulkImport] Error:',
        err
      );

      const backendMessage =
        err?.message ||
        err?.details ||
        'No fue posible completar la importacion.';

      setParseErrors([
        String(backendMessage),
      ]);

      setImportSuccessMessage(null);

    } finally {
      setIsImporting(false);
    }
  };

  const newUsersCount = rows.filter((r) => r.isNewUser).length;
  const existingUsersCount = rows.filter((r) => !r.isNewUser).length;
  const totalCapitalCop = rows.reduce((acc, r) => acc + (Number(r.capitalCop) || 0), 0);
  const totalUsd = rows.reduce((acc, r) => acc + (Number(r.totalUsdEarnings) || 0), 0);
  const totalCopEarnings = rows.reduce((acc, r) => acc + (Number(r.totalCopEarnings) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-[#080d1a]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-100">
                  Migración e Importación Masiva de Bitácoras (Excel)
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-900/60 text-blue-300 border border-blue-700/50">
                  .XLSX / .XLS / .CSV
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Lee automáticamente los clientes, capital invertido en COP, USD operados y utilidades de tu archivo Excel.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 custom-scrollbar flex-1 bg-slate-900">
          {/* Top Options Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
            {/* Cycle Selector */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                Ciclo Mensual Destino:
              </label>
              <select
                value={selectedCycleId}
                onChange={(e) => setSelectedCycleId(e.target.value)} disabled
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                {cycles.map((c) => (
                  <option key={c.cycleId} value={c.cycleId}>
                    {c.name} ({c.cycleId}) {c.status === 'CLOSED' ? '[CERRADO]' : '[ABIERTO]'}
                  </option>
                ))}
              </select>
            </div>

            {/* Target Category Filter */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                Bitácora Objetivo:
              </label>
              <select
                value={targetCategory}
                onChange={(e) => setTargetCategory(e.target.value as any)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">Auto-clasificar por Capital (Azul, Verde, Negra)</option>
                <option value="AZUL">Forzar a Bitácora Azul ($2M - $9.999.999 COP)</option>
                <option value="VERDE">Forzar a Bitácora Verde ($10M - $59.999.999 COP)</option>
                <option value="NEGRA">Forzar a Bitácora Negra ($60M+ COP)</option>
              </select>
            </div>

            {/* Sample Template Download */}
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => downloadSampleBitacoraExcel(targetCategory === 'ALL' ? 'General' : targetCategory)}
                className="w-full py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-blue-400" />
                <span>Descargar Plantilla (.xlsx)</span>
              </button>
            </div>
          </div>

          {/* Upload Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2.5 ${
              isDragging
                ? 'border-blue-500 bg-blue-950/20'
                : 'border-slate-700/80 hover:border-blue-500/50 bg-slate-950/40 hover:bg-slate-950/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => e.target.files && e.target.files[0] && handleFileChange(e.target.files[0])}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-xl bg-blue-600/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-200">
                {file ? file.name : 'Haz clic o arrastra tu archivo Excel aquí'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Formatos compatibles: .xlsx, .xls, .csv (como la tabla de agosto con columnas CLIENTES, CAPITAL INVERTIDO COP, TOTAL USD GANANCIAS, TOTAL GANANCIAS COP, etc.)
              </p>
            </div>
          </div>

          {/* Parsing Spinner */}
          {isParsing && (
            <div className="p-4 rounded-xl bg-blue-950/40 border border-blue-500/30 text-center text-xs text-blue-300 flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <span>Analizando estructura y reconociendo columnas del Excel...</span>
            </div>
          )}

          {/* Error List */}
          {parseErrors.length > 0 && (
            <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-800/60 text-xs text-rose-300 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-rose-200">
                <AlertCircle className="w-4 h-4" />
                <span>Atención:</span>
              </div>
              {parseErrors.map((err, i) => (
                <p key={i} className="pl-5 list-disc">{err}</p>
              ))}
            </div>
          )}

          {/* Success Message Banner */}
          {importSuccessMessage && (
            <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{importSuccessMessage}</span>
            </div>
          )}

          {/* Extracted Data Preview */}
          {rows.length > 0 && (
            <div className="space-y-3">
              {/* Summary Stats Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">Registros</span>
                  <span className="text-lg font-bold text-white">{rows.length}</span>
                </div>
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/40">
                  <span className="text-[10px] font-semibold text-emerald-400 block uppercase">Nuevos Usuarios</span>
                  <span className="text-lg font-bold text-emerald-300 flex items-center gap-1">
                    <UserPlus className="w-4 h-4" />
                    {newUsersCount}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-800/40">
                  <span className="text-[10px] font-semibold text-blue-400 block uppercase">Existentes</span>
                  <span className="text-lg font-bold text-blue-300 flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {existingUsersCount}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">Capital Total COP</span>
                  <span className="text-sm sm:text-base font-bold text-slate-100 truncate block">
                    ${totalCapitalCop.toLocaleString('es-CO')}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/40">
                  <span className="text-[10px] font-semibold text-amber-400 block uppercase">Total USD Ganancias</span>
                  <span className="text-sm sm:text-base font-bold text-amber-300 truncate block">
                    ${totalUsd.toLocaleString('es-CO')} USD
                  </span>
                </div>
              </div>

              {/* Migration Options */}
              <div className="flex flex-wrap gap-4 p-3 rounded-xl bg-slate-950/40 border border-slate-800 text-xs">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCreateUsers}
                    onChange={(e) => setAutoCreateUsers(e.target.checked)}
                    className="rounded border-slate-700 text-blue-600 focus:ring-0"
                  />
                  <span>Crear automáticamente perfiles para nuevos inversionistas</span>
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={updateExistingCapital}
                    onChange={(e) => setUpdateExistingCapital(e.target.checked)}
                    className="rounded border-slate-700 text-blue-600 focus:ring-0"
                  />
                  <span>Actualizar capital de inversionistas existentes con este archivo</span>
                </label>
              </div>

              {/* Data Table Preview */}
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <div className="max-h-72 overflow-y-auto overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#0b1324] text-slate-300 font-bold border-b border-slate-800 sticky top-0 z-10 text-[11px]">
                      <tr>
                        <th className="py-2.5 px-3">Cliente / Inversionista</th>
                        <th className="py-2.5 px-3 text-right">Capital COP</th>
                        <th className="py-2.5 px-3 text-center">Bitácora</th>
                        <th className="py-2.5 px-3 text-right">Total USD</th>
                        <th className="py-2.5 px-3 text-right">Total Ganancias COP</th>
                        <th className="py-2.5 px-3 text-right">Total Cliente COP</th>
                        <th className="py-2.5 px-3 text-right">Comisión Admin COP</th>
                        <th className="py-2.5 px-3 text-center">Estado</th>
                        <th className="py-2.5 px-3 text-center">Tipo</th>
                        <th className="py-2.5 px-2 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {rows.map((row) => (
                        <tr key={row.rawId} className="hover:bg-slate-800/40 transition">
                          <td className="py-2 px-3 font-sans font-semibold text-slate-100">
                            {row.clientName}
                            {row.matchedUserCode && (
                              <span className="block text-[10px] text-blue-400 font-mono font-normal">
                                {row.matchedUserCode}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-200">
                            ${row.capitalCop.toLocaleString('es-CO')}
                          </td>
                          <td className="py-2 px-3 text-center font-sans">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                row.category === 'AZUL'
                                  ? 'bg-blue-950 text-blue-300 border border-blue-800'
                                  : row.category === 'VERDE'
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                  : 'bg-slate-800 text-slate-300 border border-slate-600'
                              }`}
                            >
                              {row.category}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-amber-300 font-bold">
                            ${row.totalUsdEarnings}
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-400">
                            ${row.totalCopEarnings.toLocaleString('es-CO')}
                          </td>
                          <td className="py-2 px-3 text-right text-cyan-300">
                            ${row.totalClientCop.toLocaleString('es-CO')}
                          </td>
                          <td className="py-2 px-3 text-right text-purple-300">
                            ${row.totalCommissionCop.toLocaleString('es-CO')}
                          </td>
                          <td className="py-2 px-3 text-center font-sans">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-900/60 text-emerald-300 border border-emerald-700/50">
                              {row.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center font-sans">
                            {row.isNewUser ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center justify-center gap-1">
                                <UserPlus className="w-3 h-3" />
                                Nuevo
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 flex items-center justify-center gap-1">
                                <Users className="w-3 h-3" />
                                Existente
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(row.rawId)}
                              className="text-slate-500 hover:text-rose-400 p-1 rounded transition"
                              title="Eliminar fila"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#080d1a]">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Info className="w-4 h-4 text-blue-400 shrink-0" />
            <span>
              Los nuevos inversionistas se guardarán en Firestore como pendientes de activación para el ciclo PREPARING {selectedCycleId}. No se crean liquidaciones ni resultados del ciclo desde el Excel.
            </span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer flex-1 sm:flex-none"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={rows.length === 0 || isImporting || !preparingCycleId || !preparingCycle}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition cursor-pointer flex-1 sm:flex-none"
            >
              <Sparkles className="w-4 h-4" />
              <span>
                {isImporting
                  ? 'Importando Datos...'
                  : `Confirmar e Importar ${rows.length} Registros`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
