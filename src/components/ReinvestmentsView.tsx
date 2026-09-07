import React, { useState } from 'react';
import {
  RotateCcw,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  TrendingUp,
  CreditCard,
  AlertCircle,
  DollarSign,
  Banknote,
  Building2,
  ShieldAlert,
  Filter,
  Check,
  FileCheck,
} from 'lucide-react';
import { dataStore } from '../lib/dataStore';
import { useAuth } from '../context/AuthContext';
import { ReinvestmentRequest, InvestmentRequest, DisbursementRequest } from '../types';
import { formatCOP, formatUSD } from '../lib/financialEngine';
import confetti from 'canvas-confetti';

export const ReinvestmentsView: React.FC = () => {
  const { currentUser } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'disbursements' | 'reinvest' | 'waitlist'>('disbursements');
  const [disbursementFilter, setDisbursementFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED'>('ALL');

  const disbursements = dataStore.getDisbursements();
  const reinvestments = dataStore.getReinvestments();
  const waitlist = dataStore.getInvestments();

  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Filtered disbursements
  const filteredDisbursements = disbursements.filter((d) => {
    if (disbursementFilter === 'ALL') return true;
    return d.status === disbursementFilter;
  });

  // Disbursement handlers
  const handleApproveDisbursement = (req: DisbursementRequest) => {
    try {
      dataStore.approveDisbursement(
        req.id,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setStatusMessage(`Desembolso de ${formatCOP(req.amountCop)} para ${req.userName} aprobado.`);
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.6 },
      });
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  const handleMarkPaidDisbursement = (req: DisbursementRequest) => {
    const defaultVoucher =
      req.method === 'EFECTIVO'
        ? `Recibo Caja Taquilla #${Math.floor(100000 + Math.random() * 900000)}`
        : `Comprobante Transferencia #${Math.floor(10000000 + Math.random() * 90000000)}`;

    const voucher = prompt('Ingresa el número de comprobante o referencia de pago:', defaultVoucher);
    if (!voucher) return;

    try {
      dataStore.markDisbursementAsPaid(
        req.id,
        voucher,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setStatusMessage(`Desembolso de ${formatCOP(req.amountCop)} marcado como PAGADO.`);
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  const handleRejectDisbursement = (req: DisbursementRequest) => {
    const reason = prompt('Ingresa el motivo del rechazo del desembolso:', 'Datos de cuenta erróneos');
    if (!reason) return;

    try {
      dataStore.rejectDisbursement(
        req.id,
        reason,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setStatusMessage(`Solicitud de desembolso rechazada.`);
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  const handleApproveReinvestment = (req: ReinvestmentRequest) => {
    try {
      dataStore.approveReinvestment(
        req.id,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setStatusMessage(`Solicitud de reinversión para ${req.userName} aprobada con éxito.`);
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.6 },
      });
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  const handleRejectReinvestment = (req: ReinvestmentRequest) => {
    const reason = prompt('Ingresa el motivo del rechazo de la solicitud de reinversión:', 'Cupo mensual cerrado');
    if (!reason) return;

    try {
      dataStore.rejectReinvestment(
        req.id,
        reason,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Administrador Principal'
      );
      setStatusMessage(`Solicitud rechazada.`);
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  // Metrics for disbursements
  const pendingDisbursements = disbursements.filter((d) => d.status === 'PENDING');
  const totalPendingCop = pendingDisbursements.reduce((sum, d) => sum + d.amountCop, 0);
  const paidDisbursements = disbursements.filter((d) => d.status === 'PAID');
  const totalPaidCop = paidDisbursements.reduce((sum, d) => sum + d.amountCop, 0);
  const cashDisbursementsCount = disbursements.filter((d) => d.method === 'EFECTIVO').length;
  const transferDisbursementsCount = disbursements.filter((d) => d.method === 'TRANSFERENCIA').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-100 flex items-center gap-2">
            <Banknote className="w-6 h-6 text-emerald-400" />
            Desembolsos, Reinversiones & Espera
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Mesa de control de dispersión de utilidades y política de desembolsos V2.1
          </p>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800 flex-wrap">
          <button
            onClick={() => setActiveSubTab('disbursements')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'disbursements'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Banknote className="w-3.5 h-3.5" />
            <span>Desembolsos ({pendingDisbursements.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('reinvest')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'reinvest'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reinversiones ({reinvestments.filter((r) => r.status === 'PENDING').length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('waitlist')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'waitlist'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Lista de Espera ({waitlist.filter((w) => w.status === 'PENDING').length})</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="p-4 rounded-xl bg-blue-950/60 border border-blue-500/40 text-blue-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Tab 0: Disbursements Management */}
      {activeSubTab === 'disbursements' && (
        <div className="space-y-6">
          {/* Top Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
              <span className="text-[11px] text-slate-400 font-semibold block uppercase">
                Pendiente por Dispersar
              </span>
              <p className="text-xl font-bold font-mono text-amber-400 mt-1">
                {formatCOP(totalPendingCop)}
              </p>
              <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                {pendingDisbursements.length} solicitudes activas
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
              <span className="text-[11px] text-slate-400 font-semibold block uppercase">
                Total Pagado / Liquidado
              </span>
              <p className="text-xl font-bold font-mono text-emerald-400 mt-1">
                {formatCOP(totalPaidCop)}
              </p>
              <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                {paidDisbursements.length} pagos realizados
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
              <span className="text-[11px] text-slate-400 font-semibold block uppercase">
                En Efectivo (Taquilla / Sede)
              </span>
              <p className="text-xl font-bold font-mono text-slate-200 mt-1">
                {cashDisbursementsCount}
              </p>
              <span className="text-[10px] text-amber-400/90 font-mono mt-0.5 block">
                Incluye retiros &gt; $10M COP obligatorios
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
              <span className="text-[11px] text-slate-400 font-semibold block uppercase">
                Por Transferencia Bancaria
              </span>
              <p className="text-xl font-bold font-mono text-blue-400 mt-1">
                {transferDisbursementsCount}
              </p>
              <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                Máximo permitido: $10.000.000 COP
              </span>
            </div>
          </div>

          {/* Institutional Rule Notice Banner */}
          <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 flex items-start gap-3 text-xs text-amber-300">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-200">
                Regla Operativa V2.1: Política de Desembolsos
              </p>
              <p className="text-amber-300/90 text-[11px] mt-0.5 leading-relaxed">
                Los inversionistas escogen entre <strong>Transferencia Bancaria</strong> o <strong>Efectivo</strong>. Sin embargo, para transferencias superiores a <strong>$10.000.000 COP</strong>, el sistema exige y aplica obligatoriamente la entrega en <strong>EFECTIVO</strong> en taquilla o sede de tesorería institucional por motivos de seguridad y normatividad bancaria.
              </p>
            </div>
          </div>

          {/* Table Container */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
                  Mesa de Pagos & Solicitudes de Desembolso
                </h3>
                <span className="text-xs text-slate-400">
                  Total de {disbursements.length} registros radicados en el sistema
                </span>
              </div>

              {/* Status Filters */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {(['ALL', 'PENDING', 'APPROVED', 'PAID', 'REJECTED'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setDisbursementFilter(filter)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono transition cursor-pointer ${
                      disbursementFilter === filter
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {filter === 'ALL'
                      ? 'Todos'
                      : filter === 'PENDING'
                      ? 'Pendientes'
                      : filter === 'APPROVED'
                      ? 'Aprobados'
                      : filter === 'PAID'
                      ? 'Pagados'
                      : 'Rechazados'}
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Cards for Disbursements (block md:hidden) */}
            <div className="block md:hidden divide-y divide-slate-800/60">
              {filteredDisbursements.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs">
                  No se encontraron solicitudes de desembolso para el filtro seleccionado.
                </div>
              ) : (
                filteredDisbursements.map((req) => (
                  <div key={req.id} className="p-4 space-y-3 hover:bg-slate-950/40 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-100 text-sm">{req.userName}</span>
                          <span className="text-[10px] font-mono text-blue-400">({req.userCode})</span>
                        </div>
                        <span className="font-mono text-xs text-slate-500">{req.id} • {new Date(req.createdAt).toLocaleDateString('es-CO')}</span>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                          req.status === 'PAID'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                            : req.status === 'APPROVED'
                            ? 'bg-blue-950 text-blue-300 border border-blue-500/30'
                            : req.status === 'REJECTED'
                            ? 'bg-red-950 text-red-300 border border-red-500/30'
                            : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {req.status === 'PAID'
                          ? 'Pagado ✓'
                          : req.status === 'APPROVED'
                          ? 'Aprobado'
                          : req.status === 'REJECTED'
                          ? 'Rechazado'
                          : 'Pendiente'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">Monto:</span>
                        <span className="font-mono font-bold text-slate-100 text-sm">{formatCOP(req.amountCop)}</span>
                      </div>

                      <div className="pt-2 border-t border-slate-800/60 text-xs">
                        {req.method === 'EFECTIVO' ? (
                          <div className="space-y-0.5">
                            <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold font-mono">
                              💵 Efectivo en Taquilla
                            </span>
                            <p className="text-[11px] text-slate-300 mt-1">{req.cashOffice || 'Sede Principal'}</p>
                            <p className="text-[10px] text-slate-400 font-mono">Reclama: {req.receiverFullName}</p>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 border border-blue-500/30 text-[10px] font-bold font-mono">
                              💳 Transferencia: {req.bankName}
                            </span>
                            <p className="text-[11px] text-slate-300 font-mono mt-1">{req.accountNumber} ({req.accountType})</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {req.paymentVoucher && (
                      <div className="text-[10px] text-slate-500 font-mono truncate">
                        Comprobante: {req.paymentVoucher}
                      </div>
                    )}

                    {/* Action buttons */}
                    {req.status === 'PENDING' && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleApproveDisbursement(req)}
                          className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer flex items-center justify-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Aprobar</span>
                        </button>
                        <button
                          onClick={() => handleMarkPaidDisbursement(req)}
                          className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer flex items-center justify-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Pagar</span>
                        </button>
                        <button
                          onClick={() => handleRejectDisbursement(req)}
                          className="px-3 py-2 bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-300 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
                        >
                          Rechazar
                        </button>
                      </div>
                    )}

                    {req.status === 'APPROVED' && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleMarkPaidDisbursement(req)}
                          className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer flex items-center justify-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Registrar Pago</span>
                        </button>
                        <button
                          onClick={() => handleRejectDisbursement(req)}
                          className="px-3 py-2 bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-300 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
                        >
                          Rechazar
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Desktop Table for Disbursements (hidden md:block) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="pb-3 px-3">Fecha / Radicado</th>
                    <th className="pb-3 px-3">Inversionista</th>
                    <th className="pb-3 px-3">Monto Solicitado</th>
                    <th className="pb-3 px-3">Método & Destino</th>
                    <th className="pb-3 px-3">Estado</th>
                    <th className="pb-3 px-3 text-right">Acciones de Tesorería</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {filteredDisbursements.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                        No se encontraron solicitudes de desembolso para el filtro seleccionado.
                      </td>
                    </tr>
                  ) : (
                    filteredDisbursements.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-950/40 transition">
                        <td className="py-3.5 px-3">
                          <span className="font-mono text-slate-300 font-semibold">{req.id}</span>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {new Date(req.createdAt).toLocaleDateString('es-CO')}
                          </p>
                        </td>

                        <td className="py-3.5 px-3">
                          <p className="font-bold text-slate-200">{req.userName}</p>
                          <span className="text-[10px] font-mono text-blue-400">{req.userCode}</span>
                        </td>

                        <td className="py-3.5 px-3">
                          <span className="font-mono font-bold text-slate-100 text-sm">
                            {formatCOP(req.amountCop)}
                          </span>
                          <p className="text-[10px] text-slate-400">
                            {req.disbursementSource === 'PROFIT' ? 'Utilidades Ciclo' : 'Capital Mixto'}
                          </p>
                        </td>

                        <td className="py-3.5 px-3">
                          {req.method === 'EFECTIVO' ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold font-mono">
                                  💵 Efectivo en Taquilla
                                </span>
                                {req.amountCop > 10_000_000 && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40 text-[9px] font-bold font-mono">
                                    Regla &gt; $10M COP
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-300">
                                {req.cashOffice || 'Sede Principal'}
                              </p>
                              <p className="text-[10px] text-slate-400 font-mono">
                                Reclama: {req.receiverFullName} (CC: {req.receiverId || req.idDocument})
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-500/30 text-[10px] font-bold font-mono">
                                💳 Transferencia Bancaria
                              </span>
                              <p className="text-[11px] text-slate-300">
                                {req.bankName} • {req.accountType}
                              </p>
                              <p className="text-[10px] text-slate-400 font-mono">
                                {req.accountNumber} • {req.accountHolderName}
                              </p>
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-3">
                          <span
                            className={`px-2.5 py-1 rounded text-[10px] font-bold font-mono block w-fit ${
                              req.status === 'PAID'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                                : req.status === 'APPROVED'
                                ? 'bg-blue-950 text-blue-300 border border-blue-500/30'
                                : req.status === 'REJECTED'
                                ? 'bg-red-950 text-red-300 border border-red-500/30'
                                : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {req.status === 'PAID'
                              ? 'Pagado / Entregado ✓'
                              : req.status === 'APPROVED'
                              ? 'Aprobado (Listo)'
                              : req.status === 'REJECTED'
                              ? 'Rechazado'
                              : 'Pendiente'}
                          </span>
                          {req.paymentVoucher && (
                            <span className="text-[10px] text-slate-500 font-mono mt-1 block truncate max-w-xs">
                              {req.paymentVoucher}
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-3 text-right">
                          {req.status === 'PENDING' && (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleApproveDisbursement(req)}
                                className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-xs shadow-md transition cursor-pointer"
                              >
                                Aprobar
                              </button>
                              <button
                                onClick={() => handleRejectDisbursement(req)}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-300 rounded-lg text-xs font-semibold border border-slate-700 transition cursor-pointer"
                              >
                                Rechazar
                              </button>
                            </div>
                          )}

                          {req.status === 'APPROVED' && (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleMarkPaidDisbursement(req)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow-md shadow-emerald-600/20 transition cursor-pointer flex items-center gap-1"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Registrar Pago</span>
                              </button>
                              <button
                                onClick={() => handleRejectDisbursement(req)}
                                className="px-2 py-1.5 bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-300 rounded-lg text-xs font-semibold border border-slate-700 transition cursor-pointer"
                              >
                                Rechazar
                              </button>
                            </div>
                          )}

                          {req.status === 'PAID' && (
                            <div className="text-right">
                              <span className="text-[11px] text-emerald-400 font-semibold flex items-center justify-end gap-1">
                                <FileCheck className="w-3.5 h-3.5" />
                                Dispersado
                              </span>
                              <p className="text-[10px] text-slate-500 font-mono">
                                {req.resolvedBy || 'Tesorería'}
                              </p>
                            </div>
                          )}

                          {req.status === 'REJECTED' && (
                            <div className="text-right">
                              <span className="text-[11px] text-red-400 font-semibold">
                                Rechazado
                              </span>
                              <p className="text-[10px] text-slate-500 italic max-w-xs truncate">
                                {req.rejectionReason}
                              </p>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 1: Reinvestments */}
      {activeSubTab === 'reinvest' && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              Solicitudes de Reinversión de Ganancias
            </h3>
            <span className="text-xs text-slate-400">
              Al aprobar, el capital del usuario se actualiza y se reclasifica de bitácora automáticamente
            </span>
          </div>

          {/* Mobile Cards for Reinvestments (block md:hidden) */}
          <div className="block md:hidden divide-y divide-slate-800/60">
            {reinvestments.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                No hay solicitudes de reinversión registradas.
              </div>
            ) : (
              reinvestments.map((req) => (
                <div key={req.id} className="p-4 space-y-3 hover:bg-slate-950/40 transition">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-slate-100 text-sm">{req.userName}</h4>
                      <p className="text-[10px] font-mono text-slate-400">{req.userCode} • Ciclo: {req.sourceCycleId}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                        req.status === 'APPROVED'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                          : req.status === 'REJECTED'
                          ? 'bg-red-950 text-red-300 border border-red-500/30'
                          : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {req.status === 'APPROVED' ? 'Aprobada ✓' : req.status === 'REJECTED' ? 'Rechazada' : 'Pendiente'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                      <span className="text-[10px] text-slate-500 uppercase block font-semibold">Monto a Reinvertir</span>
                      <span className="font-mono font-bold text-emerald-400 text-sm mt-0.5 block">
                        +{formatCOP(req.reinvestAmountCop)}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                      <span className="text-[10px] text-slate-500 uppercase block font-semibold">Nuevo Capital Base</span>
                      <span className="font-mono font-bold text-slate-100 text-sm mt-0.5 block">
                        {formatCOP(req.newCapitalTargetCop)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400">Nueva Bitácora:</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-bold font-mono ${
                          req.newCategoryTarget === 'VERDE'
                            ? 'bg-emerald-950 text-emerald-300'
                            : req.newCategoryTarget === 'AZUL'
                            ? 'bg-blue-950 text-blue-300'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {req.newCategoryTarget}
                      </span>
                    </div>

                    {req.status === 'PENDING' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApproveReinvestment(req)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow-sm transition cursor-pointer"
                        >
                          Aprobar
                        </button>
                        <button
                          onClick={() => handleRejectReinvestment(req)}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-300 rounded-lg text-xs font-semibold border border-slate-700 transition cursor-pointer"
                        >
                          Rechazar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop Table for Reinvestments (hidden md:block) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="pb-3 px-3">Fecha / Ciclo</th>
                  <th className="pb-3 px-3">Inversionista</th>
                  <th className="pb-3 px-3">Ganancia Disponible</th>
                  <th className="pb-3 px-3">Monto a Reinvertir</th>
                  <th className="pb-3 px-3">Nuevo Capital Estimado</th>
                  <th className="pb-3 px-3">Nueva Bitácora</th>
                  <th className="pb-3 px-3">Estado</th>
                  <th className="pb-3 px-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {reinvestments.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-950/40 transition">
                    <td className="py-3.5 px-3">
                      <span className="font-mono text-slate-300">{req.sourceCycleId}</span>
                      <p className="text-[10px] text-slate-500">
                        {new Date(req.createdAt).toLocaleDateString('es-CO')}
                      </p>
                    </td>

                    <td className="py-3.5 px-3">
                      <p className="font-bold text-slate-200">{req.userName}</p>
                      <span className="text-[10px] font-mono text-slate-400">{req.userCode}</span>
                    </td>

                    <td className="py-3.5 px-3 font-mono text-slate-400">
                      {formatCOP(req.availableProfitCop)}
                    </td>

                    <td className="py-3.5 px-3 font-mono font-bold text-emerald-400">
                      +{formatCOP(req.reinvestAmountCop)}
                    </td>

                    <td className="py-3.5 px-3 font-mono font-bold text-slate-100 text-sm">
                      {formatCOP(req.newCapitalTargetCop)}
                    </td>

                    <td className="py-3.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                          req.newCategoryTarget === 'VERDE'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                            : req.newCategoryTarget === 'AZUL'
                            ? 'bg-blue-950 text-blue-300 border border-blue-500/30'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {req.newCategoryTarget}
                      </span>
                    </td>

                    <td className="py-3.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                          req.status === 'APPROVED'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                            : req.status === 'REJECTED'
                            ? 'bg-red-950 text-red-300 border border-red-500/30'
                            : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {req.status === 'APPROVED' ? 'Aprobada ✓' : req.status === 'REJECTED' ? 'Rechazada' : 'Pendiente'}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 text-right">
                      {req.status === 'PENDING' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleApproveReinvestment(req)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow-md shadow-emerald-600/20 transition cursor-pointer"
                          >
                            Aprobar
                          </button>
                          <button
                            onClick={() => handleRejectReinvestment(req)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-300 rounded-lg text-xs font-semibold border border-slate-700 transition cursor-pointer"
                          >
                            Rechazar
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500">Completada</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Waitlist */}
      {activeSubTab === 'waitlist' && (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              Lista de Espera para Nuevas Inyecciones de Capital
            </h3>
            <span className="text-xs text-slate-400">Orden estricto de prelación por cola (#1, #2...)</span>
          </div>

          {/* Mobile Cards for Waitlist (block md:hidden) */}
          <div className="block md:hidden divide-y divide-slate-800/60">
            {waitlist.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                No hay personas en lista de espera actualmente.
              </div>
            ) : (
              waitlist.map((w) => (
                <div key={w.id} className="p-4 space-y-2 hover:bg-slate-950/40 transition">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-blue-950 border border-blue-500/40 text-blue-300 font-black font-mono flex items-center justify-center text-xs">
                        #{w.queuePosition}
                      </span>
                      <div>
                        <h4 className="font-bold text-slate-100 text-sm">{w.userName}</h4>
                        <span className="text-[10px] font-mono text-slate-400">{w.userCode}</span>
                      </div>
                    </div>

                    <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-500/30 text-amber-300 text-[10px] font-bold font-mono">
                      En Espera
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-slate-400">Capital Solicitado:</span>
                    <span className="font-mono font-bold text-slate-100 text-sm">
                      {formatCOP(w.requestedAmountCop)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>{w.paymentMethod}</span>
                    <span>{new Date(w.createdAt).toLocaleDateString('es-CO')}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop Table for Waitlist (hidden md:block) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="pb-3 px-3">Turno</th>
                  <th className="pb-3 px-3">Inversionista</th>
                  <th className="pb-3 px-3">Capital Solicitado</th>
                  <th className="pb-3 px-3">Método de Pago</th>
                  <th className="pb-3 px-3">Fecha de Registro</th>
                  <th className="pb-3 px-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {waitlist.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-950/40 transition">
                    <td className="py-3.5 px-3">
                      <span className="w-7 h-7 rounded-lg bg-blue-950 border border-blue-500/40 text-blue-300 font-black font-mono flex items-center justify-center text-xs">
                        #{w.queuePosition}
                      </span>
                    </td>
                    <td className="py-3.5 px-3">
                      <p className="font-bold text-slate-200">{w.userName}</p>
                      <span className="text-[10px] font-mono text-slate-400">{w.userCode}</span>
                    </td>
                    <td className="py-3.5 px-3 font-mono font-bold text-slate-100 text-sm">
                      {formatCOP(w.requestedAmountCop)}
                    </td>
                    <td className="py-3.5 px-3 text-slate-300">
                      {w.paymentMethod}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-slate-400 text-[11px]">
                      {new Date(w.createdAt).toLocaleDateString('es-CO')}
                    </td>
                    <td className="py-3.5 px-3">
                      <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-500/30 text-amber-300 text-[10px] font-bold font-mono">
                        En Espera
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
