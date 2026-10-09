import React from 'react';
import {
  Megaphone,
  Send,
  Save,
  Archive,
  Users,
  Search,
  Eye,
  CheckCircle2,
  Clock3,
  AlertTriangle,
  Info,
  Pencil,
  Globe2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dataStore } from '../lib/dataStore';
import { firestoreService } from '../lib/firestoreService';
import {
  Announcement,
  AnnouncementAudienceType,
  AnnouncementKind,
  AnnouncementRead,
  BitacoraCategory,
  UserProfile,
} from '../types';

const KIND_META: Record<AnnouncementKind, { label: string; badge: string; icon: React.ReactNode }> = {
  INFO: {
    label: 'Información',
    badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    icon: <Info className="w-4 h-4" />,
  },
  IMPORTANT: {
    label: 'Importante',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  UPDATE: {
    label: 'Actualización',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    icon: <Megaphone className="w-4 h-4" />,
  },
  NEWS: {
    label: 'Noticia',
    badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    icon: <Globe2 className="w-4 h-4" />,
  },
};

const CATEGORY_META: Record<BitacoraCategory, string> = {
  AZUL: 'Bitácora Azul',
  VERDE: 'Bitácora Verde',
  NEGRA: 'Bitácora Negra',
};

function makeClientId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

  return `${prefix}_${randomPart.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function valueToDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.toMillis === 'function') return new Date(value.toMillis());
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value: any): string {
  const date = valueToDate(value);
  if (!date) return '—';
  return date.toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function audienceLabel(item: Announcement): string {
  if (item.audienceType === 'ALL_ACTIVE') {
    return `Todos los inversionistas${item.targetUsersCount != null ? ` · ${item.targetUsersCount}` : ''}`;
  }

  if (item.audienceType === 'CATEGORY') {
    const category = item.targetCategory || 'AZUL';
    return `${CATEGORY_META[category]}${item.targetUsersCount != null ? ` · ${item.targetUsersCount}` : ''}`;
  }

  return `Usuarios seleccionados${item.targetUsersCount != null ? ` · ${item.targetUsersCount}` : ''}`;
}

export const AnnouncementsView: React.FC = () => {
  const { currentUser, isSuperAdmin } = useAuth();
  const currentUid = String(currentUser?.uid || currentUser?.id || '').trim();

  const [announcements, setAnnouncements] = React.useState<Announcement[]>([]);
  const [reads, setReads] = React.useState<AnnouncementRead[]>([]);
  const [storeRevision, setStoreRevision] = React.useState(0);

  React.useEffect(() => dataStore.subscribe(() => setStoreRevision((v) => v + 1)), []);

  React.useEffect(() => {
    if (isSuperAdmin) {
      return firestoreService.listenAnnouncementsForAdmin(setAnnouncements);
    }

    if (!currentUid) {
      setAnnouncements([]);
      return;
    }

    return firestoreService.listenAnnouncementsForUser(currentUid, setAnnouncements);
  }, [isSuperAdmin, currentUid]);

  React.useEffect(() => {
    if (isSuperAdmin || !currentUid) {
      setReads([]);
      return;
    }

    return firestoreService.listenAnnouncementReadsForUser(currentUid, setReads);
  }, [isSuperAdmin, currentUid]);

  const activeUsers = React.useMemo(
    () =>
      dataStore
        .getUsers()
        .filter((user) => user.role === 'USER' && user.status === 'ACTIVE')
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es')),
    [storeRevision]
  );

  if (isSuperAdmin) {
    return <AdminAnnouncementsPanel announcements={announcements} activeUsers={activeUsers} />;
  }

  return (
    <UserAnnouncementsPanel
      announcements={announcements}
      reads={reads}
      currentUid={currentUid}
    />
  );
};

const AdminAnnouncementsPanel: React.FC<{
  announcements: Announcement[];
  activeUsers: UserProfile[];
}> = ({ announcements, activeUsers }) => {
  const [announcementId, setAnnouncementId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [kind, setKind] = React.useState<AnnouncementKind>('INFO');
  const [audienceType, setAudienceType] = React.useState<AnnouncementAudienceType>('ALL_ACTIVE');
  const [targetCategory, setTargetCategory] = React.useState<BitacoraCategory>('AZUL');
  const [selectedUids, setSelectedUids] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [isPublishing, setIsPublishing] = React.useState(false);
  const [busyArchiveId, setBusyArchiveId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const filteredUsers = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return activeUsers;
    return activeUsers.filter((user) =>
      [user.fullName, user.userCode, user.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [activeUsers, search]);

  const selectedSet = React.useMemo(() => new Set(selectedUids), [selectedUids]);

  const estimatedRecipients = React.useMemo(() => {
    if (audienceType === 'ALL_ACTIVE') return activeUsers.length;
    if (audienceType === 'CATEGORY') {
      return activeUsers.filter((user) => user.category === targetCategory).length;
    }
    return activeUsers.filter((user) => selectedSet.has(user.uid || user.id)).length;
  }, [activeUsers, audienceType, targetCategory, selectedSet]);

  const clearComposer = () => {
    setAnnouncementId(null);
    setTitle('');
    setBody('');
    setKind('INFO');
    setAudienceType('ALL_ACTIVE');
    setTargetCategory('AZUL');
    setSelectedUids([]);
    setSearch('');
    setMessage(null);
  };

  const buildPayload = () => {
    const id = announcementId || makeClientId('ann');
    if (!announcementId) setAnnouncementId(id);

    return {
      announcementId: id,
      title: title.trim(),
      body: body.trim(),
      kind,
      audienceType,
      targetCategory: audienceType === 'CATEGORY' ? targetCategory : null,
      targetUids: audienceType === 'USERS' ? selectedUids : [],
      clientRequestId: makeClientId('req'),
    };
  };

  const validate = (): string | null => {
    if (title.trim().length < 3 || title.trim().length > 120) {
      return 'El título debe tener entre 3 y 120 caracteres.';
    }
    if (body.trim().length < 5 || body.trim().length > 4000) {
      return 'El comunicado debe tener entre 5 y 4000 caracteres.';
    }
    if (audienceType === 'USERS' && selectedUids.length === 0) {
      return 'Selecciona al menos un inversionista.';
    }
    if (estimatedRecipients === 0) {
      return 'No hay inversionistas activos para ese destino.';
    }
    return null;
  };

  const handleSaveDraft = async () => {
    const validation = validate();
    if (validation) {
      setMessage({ type: 'error', text: validation });
      return;
    }

    setIsSaving(true);
    setMessage(null);
    try {
      const payload = buildPayload();
      const result = await firestoreService.adminSaveAnnouncementDraft(payload);
      setAnnouncementId(result.announcementId);
      setMessage({ type: 'ok', text: 'Borrador guardado correctamente.' });
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err?.message || 'No se pudo guardar el borrador.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    const validation = validate();
    if (validation) {
      setMessage({ type: 'error', text: validation });
      return;
    }

    if (
      !window.confirm(
        `¿Publicar este comunicado para ${estimatedRecipients} inversionista${estimatedRecipients === 1 ? '' : 's'}? Se enviará también una notificación push.`
      )
    ) {
      return;
    }

    setIsPublishing(true);
    setMessage(null);
    try {
      const payload = buildPayload();
      const result = await firestoreService.adminPublishAnnouncement(payload);
      setMessage({
        type: 'ok',
        text: `Comunicado publicado para ${result.targetUsersCount} inversionista${result.targetUsersCount === 1 ? '' : 's'}.`,
      });
      setTimeout(clearComposer, 900);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err?.message || 'No se pudo publicar el comunicado.' });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleEditDraft = (item: Announcement) => {
    if (item.status !== 'DRAFT') return;
    setAnnouncementId(item.id);
    setTitle(item.title || '');
    setBody(item.body || '');
    setKind(item.kind || 'INFO');
    setAudienceType(item.audienceType || 'ALL_ACTIVE');
    setTargetCategory(item.targetCategory || 'AZUL');
    setSelectedUids(item.requestedTargetUids || item.authorizedUids || []);
    setSearch('');
    setMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleArchive = async (item: Announcement) => {
    if (item.status === 'ARCHIVED') return;
    if (!window.confirm(`¿Archivar “${item.title}”? Dejará de aparecer en el Centro de Comunicados de los usuarios.`)) {
      return;
    }

    setBusyArchiveId(item.id);
    try {
      await firestoreService.adminArchiveAnnouncement({
        announcementId: item.id,
        clientRequestId: makeClientId('archive'),
      });
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err?.message || 'No se pudo archivar el comunicado.' });
    } finally {
      setBusyArchiveId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-[0.18em] mb-1.5">
            <Megaphone className="w-4 h-4" /> Centro de Comunicados
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tight">Comunicados y noticias</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            Publica avisos oficiales dentro de EasyTraders y envíalos por notificación push a los inversionistas seleccionados.
          </p>
        </div>
        {announcementId && (
          <button
            type="button"
            onClick={clearComposer}
            className="px-3 py-2 rounded-xl border border-slate-700 bg-slate-900 text-slate-300 hover:text-white text-xs font-semibold transition"
          >
            Nuevo comunicado
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] gap-5 items-start">
        <section className="rounded-2xl border border-slate-800 bg-[#090e17] shadow-xl overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-100">{announcementId ? 'Editar borrador' : 'Nuevo comunicado'}</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">El contenido completo queda guardado en la plataforma; la push funciona como aviso.</p>
            </div>
            <span className="text-[10px] font-mono px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300">
              {estimatedRecipients} destinatario{estimatedRecipients === 1 ? '' : 's'}
            </span>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {message && (
              <div
                className={`rounded-xl border px-3 py-2.5 text-xs font-medium ${
                  message.type === 'ok'
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                }`}
              >
                {message.text}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-bold text-slate-300">Título</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Ej. Cierre operativo de octubre"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60"
                />
                <span className="block text-right text-[10px] text-slate-600">{title.length}/120</span>
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-300">Tipo</span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AnnouncementKind)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
                >
                  <option value="INFO">Información</option>
                  <option value="IMPORTANT">Importante</option>
                  <option value="UPDATE">Actualización</option>
                  <option value="NEWS">Noticia</option>
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-300">Destinatarios</span>
                <select
                  value={audienceType}
                  onChange={(e) => setAudienceType(e.target.value as AnnouncementAudienceType)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500/60"
                >
                  <option value="ALL_ACTIVE">Todos los inversionistas activos</option>
                  <option value="CATEGORY">Por bitácora / categoría</option>
                  <option value="USERS">Usuarios específicos</option>
                </select>
              </label>
            </div>

            {audienceType === 'CATEGORY' && (
              <div className="grid grid-cols-3 gap-2">
                {(['AZUL', 'VERDE', 'NEGRA'] as BitacoraCategory[]).map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setTargetCategory(category)}
                    className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                      targetCategory === category
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {CATEGORY_META[category]}
                  </button>
                ))}
              </div>
            )}

            {audienceType === 'USERS' && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                <div className="p-3 border-b border-slate-800 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar por nombre, código o correo"
                      className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#070b13] border border-slate-800 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedUids(activeUsers.map((u) => u.uid || u.id).filter(Boolean))}
                    className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 px-2 py-1.5"
                  >
                    Seleccionar todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedUids([])}
                    className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 px-2 py-1.5"
                  >
                    Limpiar
                  </button>
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-slate-900">
                  {filteredUsers.map((user) => {
                    const uid = user.uid || user.id;
                    const checked = selectedSet.has(uid);
                    return (
                      <label key={uid} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-900/60 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedUids((current) =>
                              checked ? current.filter((item) => item !== uid) : [...current, uid]
                            )
                          }
                          className="accent-amber-500"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-200 truncate">{user.fullName}</p>
                          <p className="text-[10px] text-slate-500 font-mono truncate">{user.userCode} · {user.category}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <label className="space-y-1.5 block">
              <span className="text-xs font-bold text-slate-300">Mensaje</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={4000}
                rows={9}
                placeholder="Escribe o pega aquí el comunicado completo..."
                className="w-full px-3 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60 resize-y leading-relaxed"
              />
              <span className="block text-right text-[10px] text-slate-600">{body.length}/4000</span>
            </label>

            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center gap-2 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <Eye className="w-3.5 h-3.5" /> Vista previa
              </div>
              <div className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-1 text-[10px] font-bold ${KIND_META[kind].badge}`}>
                {KIND_META[kind].icon}
                {KIND_META[kind].label}
              </div>
              <h3 className="text-base font-bold text-slate-100 mt-3">{title.trim() || 'Título del comunicado'}</h3>
              <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed mt-2">
                {body.trim() || 'Aquí aparecerá el contenido que recibirán los inversionistas.'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isSaving || isPublishing}
                onClick={handleSaveDraft}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 text-xs font-bold disabled:opacity-50 transition"
              >
                <Save className="w-4 h-4" /> {isSaving ? 'Guardando...' : 'Guardar borrador'}
              </button>
              <button
                type="button"
                disabled={isSaving || isPublishing || estimatedRecipients === 0}
                onClick={handlePublish}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black disabled:opacity-50 transition shadow-lg shadow-emerald-950/30"
              >
                <Send className="w-4 h-4" /> {isPublishing ? 'Publicando...' : 'Publicar y notificar'}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-[#090e17] overflow-hidden shadow-xl">
          <div className="px-4 py-4 border-b border-slate-800 bg-slate-950/50">
            <h2 className="font-bold text-slate-100">Historial de comunicados</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Publicados, borradores y archivados.</p>
          </div>

          <div className="max-h-[790px] overflow-y-auto divide-y divide-slate-900">
            {announcements.length === 0 ? (
              <div className="py-12 px-5 text-center text-slate-500">
                <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-25" />
                <p className="text-sm">Todavía no hay comunicados.</p>
              </div>
            ) : (
              announcements.map((item) => (
                <div key={item.id} className="p-4 hover:bg-slate-950/50 transition">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${KIND_META[item.kind || 'INFO'].badge}`}>
                      {KIND_META[item.kind || 'INFO'].icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-100 break-words">{item.title}</h3>
                        <span
                          className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${
                            item.status === 'PUBLISHED'
                              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                              : item.status === 'DRAFT' || item.status === 'PUBLISHING'
                              ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {item.status === 'PUBLISHED'
                            ? 'PUBLICADO'
                            : item.status === 'PUBLISHING'
                            ? 'PUBLICANDO'
                            : item.status === 'DRAFT'
                            ? 'BORRADOR'
                            : 'ARCHIVADO'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{audienceLabel(item)}</p>
                      <p className="text-[10px] text-slate-600 mt-1">
                        {item.status === 'PUBLISHED'
                          ? `Publicado ${formatDateTime(item.publishedAt)}`
                          : `Actualizado ${formatDateTime(item.updatedAt || item.createdAt)}`}
                      </p>
                      <p className="text-xs text-slate-400 mt-2 line-clamp-3 whitespace-pre-wrap">{item.body}</p>

                      <div className="flex items-center gap-2 mt-3">
                        {item.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={() => handleEditDraft(item)}
                            className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 hover:bg-amber-500/15"
                          >
                            <Pencil className="w-3 h-3" /> Editar
                          </button>
                        )}
                        {item.status === 'PUBLISHED' && (
                          <button
                            type="button"
                            disabled={busyArchiveId === item.id}
                            onClick={() => handleArchive(item)}
                            className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-50"
                          >
                            <Archive className="w-3 h-3" /> {busyArchiveId === item.id ? 'Archivando...' : 'Archivar'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

const UserAnnouncementsPanel: React.FC<{
  announcements: Announcement[];
  reads: AnnouncementRead[];
  currentUid: string;
}> = ({ announcements, reads, currentUid }) => {
  const [showOnlyUnread, setShowOnlyUnread] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [markingId, setMarkingId] = React.useState<string | null>(null);
  const deepLinkHandledRef = React.useRef<string | null>(null);

  const readIds = React.useMemo(() => new Set(reads.map((read) => read.announcementId)), [reads]);
  const unreadCount = announcements.filter((item) => !readIds.has(item.id)).length;
  const visibleAnnouncements = showOnlyUnread
    ? announcements.filter((item) => !readIds.has(item.id))
    : announcements;

  React.useEffect(() => {
    if (!currentUid || typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('announcementId');
    if (!requestedId || deepLinkHandledRef.current === requestedId) return;

    const target = announcements.find((item) => item.id === requestedId);
    if (!target) return;

    deepLinkHandledRef.current = requestedId;
    setShowOnlyUnread(false);
    setExpandedId(requestedId);

    if (!readIds.has(requestedId)) {
      setMarkingId(requestedId);
      void firestoreService
        .markAnnouncementAsRead(requestedId, currentUid)
        .catch((err) => console.error('[Announcements] No se pudo marcar deep-link como leído:', err))
        .finally(() => setMarkingId(null));
    }
  }, [announcements, currentUid, readIds]);

  const openAnnouncement = async (item: Announcement) => {
    const willExpand = expandedId !== item.id;
    setExpandedId(willExpand ? item.id : null);

    if (willExpand && !readIds.has(item.id) && currentUid) {
      setMarkingId(item.id);
      try {
        await firestoreService.markAnnouncementAsRead(item.id, currentUid);
      } catch (err) {
        console.error('[Announcements] No se pudo marcar como leído:', err);
      } finally {
        setMarkingId(null);
      }
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-[0.18em] mb-1.5">
            <Megaphone className="w-4 h-4" /> EasyTraders
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tight">Comunicados</h1>
          <p className="text-sm text-slate-400 mt-1">Noticias, avisos y actualizaciones oficiales de la plataforma.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowOnlyUnread((value) => !value)}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition ${
            showOnlyUnread
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock3 className="w-4 h-4" />
          {showOnlyUnread ? 'Mostrando nuevos' : `Nuevos: ${unreadCount}`}
        </button>
      </div>

      {visibleAnnouncements.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-[#090e17] py-16 px-5 text-center">
          <Megaphone className="w-12 h-12 mx-auto text-slate-700 mb-3" />
          <h2 className="text-base font-bold text-slate-300">
            {showOnlyUnread ? 'No tienes comunicados nuevos' : 'No hay comunicados disponibles'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {showOnlyUnread ? 'Ya estás al día con las novedades de EasyTraders.' : 'Cuando se publique una noticia o aviso aparecerá aquí.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleAnnouncements.map((item) => {
            const isRead = readIds.has(item.id);
            const isExpanded = expandedId === item.id;
            const meta = KIND_META[item.kind || 'INFO'];

            return (
              <article
                key={item.id}
                className={`rounded-2xl border overflow-hidden transition shadow-lg ${
                  isRead
                    ? 'bg-[#090e17] border-slate-800'
                    : 'bg-gradient-to-br from-[#101727] to-[#090e17] border-amber-500/35 shadow-amber-950/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => openAnnouncement(item)}
                  className="w-full p-4 sm:p-5 text-left cursor-pointer"
                >
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${meta.badge}`}>
                      {meta.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider border rounded-full px-2 py-0.5 ${meta.badge}`}>
                          {meta.label}
                        </span>
                        {!isRead && (
                          <span className="text-[9px] font-black uppercase tracking-wider rounded-full px-2 py-0.5 bg-amber-400 text-slate-950">
                            Nuevo
                          </span>
                        )}
                        {markingId === item.id && (
                          <span className="text-[9px] text-slate-500">Marcando leído...</span>
                        )}
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-slate-100 mt-2 break-words">{item.title}</h2>
                      <p className="text-[11px] text-slate-500 mt-1">{formatDateTime(item.publishedAt || item.updatedAt)}</p>
                      <p
                        className={`text-sm text-slate-300 leading-relaxed whitespace-pre-wrap mt-3 ${
                          isExpanded ? '' : 'line-clamp-3'
                        }`}
                      >
                        {item.body}
                      </p>
                      <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-amber-400">
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" /> Mostrar menos
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" /> Leer comunicado
                          </>
                        )}
                      </div>
                    </div>
                    {isRead && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500/80 shrink-0 mt-1" aria-label="Leído" />
                    )}
                  </div>
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
