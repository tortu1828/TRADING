import React, { useState, useEffect, useMemo } from 'react';
import {
  LifeBuoy,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  MessageSquare,
  Send,
  User,
  Shield,
  FileText,
  Lock,
  ChevronRight,
  ChevronLeft,
  X,
  RefreshCw,
  Eye,
  CheckCheck,
  UserCheck,
  TrendingUp,
  DollarSign,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { firestoreService } from '../lib/firestoreService';
import {
  SupportTicket,
  SupportTicketMessage,
  SupportInternalNote,
  SupportTicketCategory,
  SupportTicketStatus,
  SupportTicketPriority,
} from '../types';
import { formatCOP } from '../lib/financialEngine';

const CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  ACCOUNT_ACCESS: 'Acceso a Cuenta',
  CAPITAL: 'Capital de Inversión',
  CYCLE: 'Ciclo Operativo',
  OPERATIONS: 'Operaciones Diarias',
  PROFITS: 'Rentabilidad / Utilidades',
  REINVESTMENT: 'Reinversiones',
  WITHDRAWAL: 'Desembolsos / Retiros',
  NOTIFICATIONS: 'Notificaciones Push',
  TECHNICAL: 'Incidencia Técnica',
  OTHER: 'Otro Motivo',
};

const STATUS_CONFIG: Record<
  SupportTicketStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  OPEN: {
    label: 'Abierto',
    bg: 'bg-blue-950/60',
    text: 'text-blue-300',
    border: 'border-blue-500/40',
  },
  IN_PROGRESS: {
    label: 'En Progreso',
    bg: 'bg-amber-950/60',
    text: 'text-amber-300',
    border: 'border-amber-500/40',
  },
  WAITING_USER: {
    label: 'Esperando Usuario',
    bg: 'bg-purple-950/60',
    text: 'text-purple-300',
    border: 'border-purple-500/40',
  },
  RESOLVED: {
    label: 'Resuelto',
    bg: 'bg-emerald-950/60',
    text: 'text-emerald-300',
    border: 'border-emerald-500/40',
  },
  CLOSED: {
    label: 'Cerrado',
    bg: 'bg-slate-800/80',
    text: 'text-slate-400',
    border: 'border-slate-700',
  },
};

const PRIORITY_CONFIG: Record<
  SupportTicketPriority,
  { label: string; text: string }
> = {
  LOW: { label: 'Baja', text: 'text-slate-400' },
  NORMAL: { label: 'Normal', text: 'text-blue-400' },
  HIGH: { label: 'Alta', text: 'text-amber-400' },
  URGENT: { label: 'Urgente', text: 'text-red-400 font-bold' },
};

export const SupportTicketsView: React.FC = () => {
  const { currentUser, isSuperAdmin, isSupportAgent } = useAuth();
  const isAgentOrAdmin = isSuperAdmin || isSupportAgent;

  // Tickets List State
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  // Messages & Notes State
  const [messages, setMessages] = useState<SupportTicketMessage[]>([]);
  const [internalNotes, setInternalNotes] = useState<SupportInternalNote[]>([]);
  const [replyText, setReplyText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [isSendingNote, setIsSendingNote] = useState(false);
  const [activeTabDetail, setActiveTabDetail] = useState<'messages' | 'notes' | 'context'>('messages');

  // Diagnostic User Context State
  const [userContext, setUserContext] = useState<{
    hasUserContext: boolean;
    hasOperationalContext: boolean;
    user?: any;
    operationalContext?: any;
    message?: string;
  } | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);

  // New Ticket Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [formSubject, setFormSubject] = useState('');
  const [formCategory, setFormCategory] = useState<SupportTicketCategory>('TECHNICAL');
  const [formDescription, setFormDescription] = useState('');
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Status/Action State
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [closeReasonPrompt, setCloseReasonPrompt] = useState(false);
  const [closeReasonText, setCloseReasonText] = useState('');

  // 1. Subscribe to tickets
  useEffect(() => {
    let unsub: () => void;
    if (isAgentOrAdmin) {
      unsub = firestoreService.listenSupportTickets((allTickets) => {
        setTickets(allTickets);
      });
    } else if (currentUser?.uid) {
      unsub = firestoreService.listenUserSupportTickets(currentUser.uid, (userTickets) => {
        setTickets(userTickets);
      });
    } else {
      unsub = () => {};
    }
    return () => unsub();
  }, [isAgentOrAdmin, currentUser?.uid]);

  // Selected Ticket Object
  const selectedTicket = useMemo(() => {
    return tickets.find((t) => t.ticketId === selectedTicketId) || null;
  }, [tickets, selectedTicketId]);

  // 2. Subscribe to messages when a ticket is selected
  useEffect(() => {
    if (!selectedTicketId) {
      setMessages([]);
      setInternalNotes([]);
      setUserContext(null);
      return;
    }

    const unsubMsgs = firestoreService.listenTicketMessages(selectedTicketId, (msgs) => {
      setMessages(msgs);
    });

    let unsubNotes = () => {};
    if (isAgentOrAdmin) {
      unsubNotes = firestoreService.listenTicketInternalNotes(selectedTicketId, (notes) => {
        setInternalNotes(notes);
      });
    }

    return () => {
      unsubMsgs();
      unsubNotes();
    };
  }, [selectedTicketId, isAgentOrAdmin]);

  // Fetch Diagnostic Context for Agents
  const handleLoadContext = async () => {
    if (!selectedTicketId) return;
    setIsLoadingContext(true);
    setActionError(null);
    try {
      const res = await firestoreService.supportGetUserContext({ ticketId: selectedTicketId });
      setUserContext(res);
      setActiveTabDetail('context');
    } catch (err: any) {
      setActionError(err.message || 'Error al obtener contexto de diagnóstico.');
    } finally {
      setIsLoadingContext(false);
    }
  };

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const matchesStatus = filterStatus === 'ALL' || ticket.status === filterStatus;
      const matchesCategory = filterCategory === 'ALL' || ticket.category === filterCategory;
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        ticket.ticketNumber.toLowerCase().includes(q) ||
        ticket.subject.toLowerCase().includes(q) ||
        ticket.createdByName.toLowerCase().includes(q) ||
        ticket.createdByUserCode.toLowerCase().includes(q);
      return matchesStatus && matchesCategory && matchesSearch;
    });
  }, [tickets, filterStatus, filterCategory, search]);

  // Create Ticket
  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formSubject.trim().length < 5) {
      setCreateError('El asunto debe tener al menos 5 caracteres.');
      return;
    }
    if (formDescription.trim().length < 10) {
      setCreateError('La descripción debe tener al menos 10 caracteres.');
      return;
    }

    setIsCreatingTicket(true);
    setCreateError(null);
    try {
      const res = await firestoreService.supportCreateTicket({
        subject: formSubject.trim(),
        category: formCategory,
        description: formDescription.trim(),
        clientRequestId: crypto.randomUUID(),
      });
      setIsCreateModalOpen(false);
      setFormSubject('');
      setFormDescription('');
      setSelectedTicketId(res.ticketId);
    } catch (err: any) {
      setCreateError(err.message || 'Error al crear el ticket de soporte.');
    } finally {
      setIsCreatingTicket(false);
    }
  };

  // Send Public Reply
  const handleSendReply = async () => {
    if (!selectedTicketId || !replyText.trim()) return;
    setIsSendingReply(true);
    setActionError(null);
    try {
      await firestoreService.supportReplyTicket({
        ticketId: selectedTicketId,
        text: replyText.trim(),
        clientRequestId: crypto.randomUUID(),
      });
      setReplyText('');
    } catch (err: any) {
      setActionError(err.message || 'Error al enviar respuesta.');
    } finally {
      setIsSendingReply(false);
    }
  };

  // Add Internal Note (Agent/Admin Only)
  const handleAddNote = async () => {
    if (!selectedTicketId || !noteText.trim()) return;
    setIsSendingNote(true);
    setActionError(null);
    try {
      await firestoreService.supportAddInternalNote({
        ticketId: selectedTicketId,
        noteText: noteText.trim(),
        clientRequestId: crypto.randomUUID(),
      });
      setNoteText('');
    } catch (err: any) {
      setActionError(err.message || 'Error al registrar nota interna.');
    } finally {
      setIsSendingNote(false);
    }
  };

  // Assign Ticket to Current Agent
  const handleAssignToMe = async () => {
    if (!selectedTicketId) return;
    setIsUpdatingStatus(true);
    setActionError(null);
    try {
      await firestoreService.supportAssignTicket({
        ticketId: selectedTicketId,
        assignedToUid: currentUser?.uid || '',
        clientRequestId: crypto.randomUUID(),
      });
    } catch (err: any) {
      setActionError(err.message || 'Error al asignar el ticket.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Change Ticket Status
  const handleUpdateStatus = async (newStatus: SupportTicketStatus, reason?: string) => {
    if (!selectedTicketId) return;
    setIsUpdatingStatus(true);
    setActionError(null);
    try {
      await firestoreService.supportUpdateTicketStatus({
        ticketId: selectedTicketId,
        status: newStatus,
        reason: reason || undefined,
        clientRequestId: crypto.randomUUID(),
      });
      setCloseReasonPrompt(false);
      setCloseReasonText('');
    } catch (err: any) {
      setActionError(err.message || 'Error al actualizar el estado del ticket.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#0a0f19] border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-blue-400" />
            <h1 className="text-lg sm:text-xl font-bold text-slate-100">
              {isAgentOrAdmin ? 'Centro de Soporte Técnico y Tickets' : 'Mesa de Ayuda y Soporte'}
            </h1>
            {isAgentOrAdmin && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-500/30">
                {isSuperAdmin ? 'SuperAdmin' : 'Agente Autorizado'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {isAgentOrAdmin
              ? 'Gestión centralizada de solicitudes de inversionistas, diagnóstico y resolución de incidencias.'
              : 'Canal oficial de atención para consultas, solicitudes de capital, reportes operativos e incidencias.'}
          </p>
        </div>

        <button
          onClick={() => {
            setCreateError(null);
            setIsCreateModalOpen(true);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30 transition flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Crear Ticket</span>
        </button>
      </div>

      {/* Main Split Layout: Ticket List & Ticket Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Tickets List */}
        <div
          className={`lg:col-span-5 space-y-3 ${
            selectedTicketId ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Search & Filters */}
          <div className="bg-[#0a0f19] border border-slate-800 rounded-2xl p-3 space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por #SUP, cliente, código..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">Todos los Estados</option>
                <option value="OPEN">Abierto</option>
                <option value="IN_PROGRESS">En Progreso</option>
                <option value="WAITING_USER">Esperando Usuario</option>
                <option value="RESOLVED">Resuelto</option>
                <option value="CLOSED">Cerrado</option>
              </select>

              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">Todas las Categorías</option>
                {Object.entries(CATEGORY_LABELS).map(([catKey, catLabel]) => (
                  <option key={catKey} value={catKey}>
                    {catLabel}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tickets List */}
          <div className="space-y-2">
            {filteredTickets.length === 0 ? (
              <div className="bg-[#0a0f19] border border-slate-800 rounded-2xl p-8 text-center text-slate-400 space-y-2">
                <LifeBuoy className="w-8 h-8 mx-auto text-slate-600" />
                <p className="text-xs">No se encontraron tickets con los filtros actuales.</p>
              </div>
            ) : (
              filteredTickets.map((ticket) => {
                const isSelected = ticket.ticketId === selectedTicketId;
                const statusMeta = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.OPEN;
                return (
                  <div
                    key={ticket.ticketId}
                    onClick={() => setSelectedTicketId(ticket.ticketId)}
                    className={`p-3.5 rounded-2xl border transition cursor-pointer space-y-2 ${
                      isSelected
                        ? 'bg-blue-950/30 border-blue-500/50 shadow-lg shadow-blue-950/40'
                        : 'bg-[#0a0f19] border-slate-800 hover:border-slate-700 hover:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-400">
                          {ticket.ticketNumber}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusMeta.bg} ${statusMeta.text} ${statusMeta.border}`}
                        >
                          {statusMeta.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(ticket.updatedAt).toLocaleDateString('es-CO', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold text-slate-100 line-clamp-1">
                        {ticket.subject}
                      </h3>
                      <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                        {ticket.lastMessagePreview || ticket.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3 h-3 text-slate-500" />
                        <span className="truncate max-w-[120px]">
                          {ticket.createdByName}
                        </span>
                        {ticket.createdByUserCode && (
                          <span className="font-mono text-[10px] text-slate-500">
                            ({ticket.createdByUserCode})
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {CATEGORY_LABELS[ticket.category] || ticket.category}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Ticket Conversation & Operations */}
        <div
          className={`lg:col-span-7 ${
            !selectedTicketId ? 'hidden lg:block' : 'block'
          }`}
        >
          {selectedTicket ? (
            <div className="bg-[#0a0f19] border border-slate-800 rounded-2xl flex flex-col h-[700px] overflow-hidden">
              {/* Ticket Header */}
              <div className="p-3.5 sm:p-4 border-b border-slate-800 bg-[#080d16] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedTicketId(null)}
                      className="lg:hidden p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <span className="font-mono text-sm font-bold text-blue-400">
                      {selectedTicket.ticketNumber}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        STATUS_CONFIG[selectedTicket.status]?.bg
                      } ${STATUS_CONFIG[selectedTicket.status]?.text} ${
                        STATUS_CONFIG[selectedTicket.status]?.border
                      }`}
                    >
                      {STATUS_CONFIG[selectedTicket.status]?.label}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 ${
                        PRIORITY_CONFIG[selectedTicket.priority]?.text
                      }`}
                    >
                      Prioridad {PRIORITY_CONFIG[selectedTicket.priority]?.label}
                    </span>
                  </div>

                  {/* Agent Actions */}
                  {isAgentOrAdmin && (
                    <div className="flex items-center gap-1.5">
                      {!selectedTicket.assignedToUid && (
                        <button
                          onClick={handleAssignToMe}
                          disabled={isUpdatingStatus}
                          className="px-2.5 py-1 rounded-lg bg-blue-600/80 hover:bg-blue-600 text-white text-[11px] font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Tomar Ticket</span>
                        </button>
                      )}
                      <button
                        onClick={handleLoadContext}
                        disabled={isLoadingContext}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        title="Ver contexto y perfil financiero"
                      >
                        <Eye className="w-3.5 h-3.5 text-blue-400" />
                        <span>Contexto</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                  <h2 className="font-bold text-slate-100 text-sm">{selectedTicket.subject}</h2>
                  <span className="text-[11px] text-slate-400">
                    {CATEGORY_LABELS[selectedTicket.category]}
                  </span>
                </div>

                {/* Sub-bar for Agents */}
                {isAgentOrAdmin && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-[11px] text-slate-400">
                    <div>
                      <span>Asignado a: </span>
                      <strong className="text-slate-200">
                        {selectedTicket.assignedToName || 'Sin asignar'}
                      </strong>
                    </div>

                    <div className="flex items-center gap-1">
                      {selectedTicket.status !== 'IN_PROGRESS' && (
                        <button
                          onClick={() => handleUpdateStatus('IN_PROGRESS')}
                          disabled={isUpdatingStatus}
                          className="px-2 py-0.5 rounded bg-amber-950/60 hover:bg-amber-900/60 border border-amber-500/30 text-amber-300 font-semibold cursor-pointer disabled:opacity-50"
                        >
                          En Progreso
                        </button>
                      )}
                      {selectedTicket.status !== 'WAITING_USER' && (
                        <button
                          onClick={() => handleUpdateStatus('WAITING_USER')}
                          disabled={isUpdatingStatus}
                          className="px-2 py-0.5 rounded bg-purple-950/60 hover:bg-purple-900/60 border border-purple-500/30 text-purple-300 font-semibold cursor-pointer disabled:opacity-50"
                        >
                          Esperando Usuario
                        </button>
                      )}
                      {selectedTicket.status !== 'RESOLVED' && selectedTicket.status !== 'CLOSED' && (
                        <button
                          onClick={() => handleUpdateStatus('RESOLVED')}
                          disabled={isUpdatingStatus}
                          className="px-2 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 font-semibold cursor-pointer disabled:opacity-50"
                        >
                          Resolver
                        </button>
                      )}
                      {selectedTicket.status !== 'CLOSED' && (
                        <button
                          onClick={() => setCloseReasonPrompt(true)}
                          disabled={isUpdatingStatus}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold cursor-pointer disabled:opacity-50"
                        >
                          Cerrar
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Close Reason Prompt */}
                {closeReasonPrompt && (
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-700 space-y-2">
                    <label className="block text-xs font-semibold text-slate-200">
                      Motivo de cierre de ticket:
                    </label>
                    <input
                      type="text"
                      value={closeReasonText}
                      onChange={(e) => setCloseReasonText(e.target.value)}
                      placeholder="Ej. Incidencia resuelta a satisfacción..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setCloseReasonPrompt(false)}
                        className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => handleUpdateStatus('CLOSED', closeReasonText)}
                        disabled={isUpdatingStatus}
                        className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg text-[11px] font-bold"
                      >
                        Confirmar Cierre
                      </button>
                    </div>
                  </div>
                )}

                {/* Error Banner */}
                {actionError && (
                  <div className="p-2 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 text-xs flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{actionError}</span>
                  </div>
                )}

                {/* Tab switch for detail view */}
                {isAgentOrAdmin && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => setActiveTabDetail('messages')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        activeTabDetail === 'messages'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Mensajes ({messages.length})
                    </button>
                    <button
                      onClick={() => setActiveTabDetail('notes')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                        activeTabDetail === 'notes'
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-900 text-amber-400 hover:text-amber-300'
                      }`}
                    >
                      <Lock className="w-3 h-3" />
                      <span>Notas Internas ({internalNotes.length})</span>
                    </button>
                    {userContext && (
                      <button
                        onClick={() => setActiveTabDetail('context')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                          activeTabDetail === 'context'
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-900 text-purple-400 hover:text-purple-300'
                        }`}
                      >
                        Contexto Diagnóstico
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Detail Content Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#070b13]">
                {activeTabDetail === 'context' && userContext ? (
                  <div className="space-y-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <span className="font-bold text-slate-100 flex items-center gap-1.5">
                          <User className="w-4 h-4 text-blue-400" />
                          Identidad del Inversionista
                        </span>
                        <span className="font-mono text-slate-400">{userContext.user?.userCode}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-slate-300">
                        <div>
                          <span className="text-slate-500">Nombre: </span>
                          <strong>{userContext.user?.fullName}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500">Estado: </span>
                          <strong className="text-emerald-400">{userContext.user?.status}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500">Bitácora: </span>
                          <strong className="font-mono">{userContext.user?.category}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500">Capital Operativo: </span>
                          <strong className="text-blue-300 font-mono">
                            {formatCOP(userContext.user?.currentCapital || 0)}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {userContext.hasOperationalContext && userContext.operationalContext && (
                      <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <span className="font-bold text-slate-100 flex items-center gap-1.5">
                            <TrendingUp className="w-4 h-4 text-emerald-400" />
                            Contexto Operacional del Ciclo
                          </span>
                          <span className="font-mono text-xs text-amber-400">
                            {userContext.operationalContext.activeCycleId || 'Sin ciclo'}
                          </span>
                        </div>

                        {userContext.operationalContext.currentResult ? (
                          <div className="grid grid-cols-2 gap-2 text-slate-300">
                            <div>
                              <span className="text-slate-500">USD Operado: </span>
                              <strong className="font-mono text-emerald-400">
                                ${userContext.operationalContext.currentResult.totalUsdOperated?.toFixed(2)}
                              </strong>
                            </div>
                            <div>
                              <span className="text-slate-500">Utilidad COP: </span>
                              <strong className="font-mono text-emerald-400">
                                {formatCOP(userContext.operationalContext.currentResult.userProfitCop || 0)}
                              </strong>
                            </div>
                          </div>
                        ) : (
                          <p className="text-slate-500 italic">No hay resultados registrados en el ciclo activo.</p>
                        )}

                        {userContext.operationalContext.reinvestment && (
                          <div className="pt-2 border-t border-slate-800">
                            <span className="text-slate-500">Solicitud de Reinversión: </span>
                            <span className="font-bold text-teal-400">
                              {userContext.operationalContext.reinvestment.status} (
                              {formatCOP(userContext.operationalContext.reinvestment.totalIncreaseCop || 0)})
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : activeTabDetail === 'notes' ? (
                  <div className="space-y-3">
                    <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
                      <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        Estas notas son <strong>estrictamente confidenciales</strong> entre agentes de soporte y SuperAdmin. Los clientes nunca tienen acceso a este canal.
                      </span>
                    </div>

                    {internalNotes.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-6">
                        No hay notas internas registradas en este ticket.
                      </p>
                    ) : (
                      internalNotes.map((note) => (
                        <div
                          key={note.noteId}
                          className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-1"
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-amber-300 flex items-center gap-1">
                              <Shield className="w-3 h-3" />
                              {note.authorName}
                            </span>
                            <span className="text-slate-500 font-mono">
                              {new Date(note.createdAt).toLocaleTimeString('es-CO', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-xs text-slate-200 whitespace-pre-wrap">{note.noteText}</p>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((msg) => {
                      const isMe = msg.senderUid === currentUser?.uid;
                      const isSupportSender = msg.senderType === 'SUPPORT' || msg.senderType === 'SUPERADMIN';

                      return (
                        <div
                          key={msg.messageId}
                          className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                        >
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1 px-1">
                            <span className="font-semibold text-slate-300">{msg.senderName}</span>
                            {isSupportSender && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-950 text-blue-300 border border-blue-500/30">
                                Soporte
                              </span>
                            )}
                            <span className="font-mono text-[10px] text-slate-500">
                              {new Date(msg.createdAt).toLocaleTimeString('es-CO', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>

                          <div
                            className={`max-w-[85%] sm:max-w-[75%] p-3 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                              isMe
                                ? 'bg-blue-600 text-white rounded-br-sm shadow-md shadow-blue-950/40'
                                : isSupportSender
                                ? 'bg-[#0f172a] border border-blue-500/30 text-slate-200 rounded-bl-sm'
                                : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-sm'
                            }`}
                          >
                            {msg.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bottom Input Area */}
              <div className="p-3 border-t border-slate-800 bg-[#0a0f19]">
                {activeTabDetail === 'notes' ? (
                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Escribe una nota interna confidencial..."
                      className="flex-1 bg-slate-950 border border-amber-500/30 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 resize-none"
                    />
                    <button
                      onClick={handleAddNote}
                      disabled={isSendingNote || !noteText.trim()}
                      className="px-4 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center justify-center transition cursor-pointer disabled:opacity-50"
                    >
                      {isSendingNote ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={
                        selectedTicket.status === 'CLOSED'
                          ? 'Este ticket está cerrado. Tu respuesta reabrirá la conversación.'
                          : 'Escribe tu respuesta al ticket...'
                      }
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
                    />
                    <button
                      onClick={handleSendReply}
                      disabled={isSendingReply || !replyText.trim()}
                      className="px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center justify-center transition cursor-pointer disabled:opacity-50"
                    >
                      {isSendingReply ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-[#0a0f19] border border-slate-800 rounded-2xl h-[500px] flex flex-col items-center justify-center text-slate-500 p-6 text-center space-y-2">
              <MessageSquare className="w-10 h-10 text-slate-600" />
              <p className="text-sm font-semibold text-slate-300">Selecciona un ticket para ver la conversación</p>
              <p className="text-xs max-w-sm">
                Puedes revisar mensajes, agregar respuestas, notas de equipo y consultar el contexto del cliente.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create Ticket Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <LifeBuoy className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-slate-100">Crear Nuevo Ticket de Soporte</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isCreatingTicket}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Categoría de la Solicitud
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as SupportTicketCategory)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  required
                >
                  {Object.entries(CATEGORY_LABELS).map(([catKey, catLabel]) => (
                    <option key={catKey} value={catKey}>
                      {catLabel}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Asunto del Ticket (mínimo 5 caracteres)
                </label>
                <input
                  type="text"
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  placeholder="Ej. Inquietud sobre el rendimiento del ciclo o retiro de capital"
                  minLength={5}
                  maxLength={120}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Descripción Detallada (mínimo 10 caracteres)
                </label>
                <textarea
                  rows={4}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Describe con claridad los detalles de tu consulta o incidencia..."
                  minLength={10}
                  maxLength={2000}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500 resize-none"
                  required
                />
              </div>

              {createError && (
                <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={isCreatingTicket}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-xl transition disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreatingTicket}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-lg shadow-blue-600/30 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isCreatingTicket ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Radicando Ticket...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Crear Ticket</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
