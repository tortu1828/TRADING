import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  Edit2,
  CheckCircle2,
  DollarSign,
  Phone,
  Mail,
  Shield,
  CreditCard,
  X,
  AlertCircle,
  TrendingUp,
  FileSpreadsheet,
  Copy,
  Check,
  MessageCircle,
  Clock,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { dataStore } from '../lib/dataStore';
import { useAuth } from '../context/AuthContext';
import { BitacoraCategory, UserProfile, UserStatus } from '../types';
import { formatCOP, getCategoryForCapital } from '../lib/financialEngine';
import { ExcelBitacoraImportModal } from './ExcelBitacoraImportModal';
import { InvestorApplicationsView } from './InvestorApplicationsView';
import { createFirebaseAuthUser } from '../lib/firebase';
import { firestoreService } from '../lib/firestoreService';

export const UserManagementView: React.FC = () => {
  const { allUsers, currentUser } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Form State
  const [subTab, setSubTab] = useState<'active' | 'queue'>('active');
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const pendingApps = dataStore.getPendingApplications();

  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('EasyTrader2026*');
  const [formPhone, setFormPhone] = useState('');
  const [formCapital, setFormCapital] = useState('');
  const [formUserSplit, setFormUserSplit] = useState('50');
  const [formBank, setFormBank] = useState('Bancolombia');
  const [formAccount, setFormAccount] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const numericCapital = parseFloat(formCapital) || 0;
  const detectedCategory = getCategoryForCapital(numericCapital);
  const adminSplit = 100 - (parseFloat(formUserSplit) || 50);

  const filteredUsers = allUsers.filter((u) => {
    if (u.role === 'ADMIN') return false; // Hide system admin from client table
    if (selectedCategory !== 'ALL' && u.category !== selectedCategory) return false;
    if (selectedStatus !== 'ALL' && u.status !== selectedStatus) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone.includes(q) ||
        u.userCode.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleOpenAdd = () => {
    setFormName('');
    setFormEmail('');
    setFormPassword('EasyTrader2026*');
    setFormPhone('');
    setFormCapital('8000000');
    setFormUserSplit('50');
    setFormBank('Bancolombia');
    setFormAccount('');
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (user: UserProfile) => {
    setEditingUser(user);
    setFormName(user.fullName);
    setFormEmail(user.email);
    setFormPhone(user.phone);
    setFormCapital(user.currentCapital.toString());
    setFormUserSplit(user.userPercentage.toString());
    setFormBank(user.paymentMethod);
    setFormAccount(user.paymentDetails);
    setFormError(null);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cap = parseFloat(formCapital);
    const split = parseFloat(formUserSplit);

    if (isNaN(cap) || cap < 4_000_000) {
      setFormError('El capital mínimo de inversión es de $4.000.000 COP (Bitácora Azul).');
      return;
    }

    if (cap > 4_000_000_000) {
      setFormError('El capital excede el límite máximo de $4.000.000.000 COP.');
      return;
    }

    if (isNaN(split) || split <= 0 || split > 100) {
      setFormError('El porcentaje del inversionista debe ser entre 1% y 100%.');
      return;
    }

    if (!editingUser && (!formPassword || formPassword.length < 6)) {
      setFormError('La contraseña inicial debe tener al menos 6 caracteres para la autenticación.');
      return;
    }

    const category = getCategoryForCapital(cap);
    setIsSubmitting(true);

    try {
      if (editingUser) {
        // Update user in dataStore and Firestore
        const updatedUser = dataStore.updateUser(
          editingUser.id,
          {
            fullName: formName,
            email: formEmail,
            phone: formPhone,
            currentCapital: cap,
            userPercentage: split,
            adminPercentage: 100 - split,
            category,
            paymentMethod: formBank,
            paymentDetails: formAccount || 'Cuenta Principal',
          },
          currentUser?.uid || 'admin_root_uid',
          currentUser?.fullName || 'Administrador Principal'
        );

        await firestoreService.saveUser(updatedUser);
        setEditingUser(null);
      } else {
        // 1. Create User in Firebase Authentication (without logging out admin)
        let authUid = `uid_${Date.now()}`;
        if (formEmail && formPassword) {
          try {
            authUid = await createFirebaseAuthUser(formEmail, formPassword);
          } catch (authErr: any) {
            console.warn('Error al registrar usuario en Firebase Auth:', authErr);
            if (authErr?.code === 'auth/email-already-in-use') {
              throw new Error('El correo electrónico ya se encuentra registrado en Firebase Authentication.');
            }
            if (authErr?.code === 'auth/weak-password') {
              throw new Error('La contraseña ingresada es demasiado débil (mínimo 6 caracteres).');
            }
            if (authErr?.code === 'auth/invalid-email') {
              throw new Error('El correo electrónico ingresado no tiene un formato válido.');
            }
            throw new Error(`Error de Autenticación Firebase: ${authErr?.message || authErr}`);
          }
        }

        // 2. Create User Profile in local state/datastore
        const newUser = dataStore.createUser(
          {
            uid: authUid,
            fullName: formName,
            email: formEmail,
            phone: formPhone,
            currentCapital: cap,
            currency: 'COP',
            userPercentage: split,
            adminPercentage: 100 - split,
            status: 'ACTIVE',
            role: 'USER',
            paymentMethod: formBank,
            paymentDetails: formAccount || 'Cuenta Principal',
            entryDate: new Date().toISOString().split('T')[0],
          },
          currentUser?.uid || 'admin_root_uid',
          currentUser?.fullName || 'Administrador Principal'
        );

        // 3. Save User in Firestore collection `users`
        await firestoreService.saveUser(newUser);

        setIsAddModalOpen(false);
      }
    } catch (err: any) {
      setFormError(err?.message || 'Ocurrió un error al guardar el usuario.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyWhatsAppAccess = (user: UserProfile) => {
    const message = `👋 *¡Hola ${user.fullName}!*
Te compartimos tus credenciales y datos de acceso a tu portal de inversionista en *EasyTraders*:

🔑 *Código de Inversionista:* \`${user.userCode}\`
💼 *Capital Registrado:* ${formatCOP(user.currentCapital)}
📊 *Bitácora Asignada:* ${user.category}
🌐 *Enlace de Acceso:* ${window.location.origin}

💡 *Instrucciones:*
1. Ingresa a la plataforma y haz clic en *"Acceso / Activar"*.
2. Selecciona la pestaña *"Activar Cuenta (Inversionistas Actuales)"*.
3. Ingresa tu código \`${user.userCode}\`, tu correo y define tu contraseña segura.`;

    navigator.clipboard.writeText(message);
    setCopiedUserId(user.id);
    setTimeout(() => setCopiedUserId(null), 3000);
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setIsDeletingUser(true);
    try {
      dataStore.deleteUser(
        userToDelete.id,
        currentUser?.uid || 'admin_root_uid',
        currentUser?.fullName || 'Juan Esteban'
      );
      await firestoreService.deleteUser(userToDelete.id);
      setUserToDelete(null);
    } catch (err: any) {
      alert(`Error al eliminar usuario: ${err?.message || err}`);
    } finally {
      setIsDeletingUser(false);
    }
  };

  if (subTab === 'queue') {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        {/* Sub-tab Navigation */}
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-900 border border-slate-800">
          <button
            onClick={() => setSubTab('active')}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-slate-100 transition cursor-pointer"
          >
            <Users className="w-4 h-4 text-blue-400" />
            <span>Inversionistas Registrados ({allUsers.filter((u) => u.role === 'USER').length})</span>
          </button>
          <button
            onClick={() => setSubTab('queue')}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm transition cursor-pointer"
          >
            <Clock className="w-4 h-4 text-amber-400" />
            <span>Cola de Admisiones Normal</span>
            {pendingApps.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-mono font-black text-[10px]">
                {pendingApps.length}
              </span>
            )}
          </button>
        </div>

        <InvestorApplicationsView />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Sub-tab Navigation */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-900 border border-slate-800">
        <button
          onClick={() => setSubTab('active')}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs bg-blue-600/20 text-blue-300 border border-blue-500/40 shadow-sm transition cursor-pointer"
        >
          <Users className="w-4 h-4 text-blue-400" />
          <span>Inversionistas Registrados ({allUsers.filter((u) => u.role === 'USER').length})</span>
        </button>
        <button
          onClick={() => setSubTab('queue')}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-slate-100 transition cursor-pointer"
        >
          <Clock className="w-4 h-4 text-amber-400" />
          <span>Cola de Admisiones Normal</span>
          {pendingApps.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-mono font-black text-[10px]">
              {pendingApps.length}
            </span>
          )}
        </button>
      </div>

      {/* Header */}
      <div className="p-4 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg sm:text-xl font-black text-slate-100 flex items-center gap-2">
              <Users className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" />
              Gestión de Inversionistas & Bitácoras
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-950 border border-blue-500/40 text-blue-300 font-mono">
              {filteredUsers.length} Inversionistas
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Asignación automática a bitácoras por capital snapshot: 🔵 Azul, 🟢 Verde o ⚫ Negra
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setIsExcelModalOpen(true)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-blue-500/50 text-slate-200 hover:text-blue-300 text-xs font-bold transition cursor-pointer shrink-0"
            title="Importar y migrar inversionistas desde archivo Excel"
          >
            <FileSpreadsheet className="w-4 h-4 text-blue-400" />
            <span>Importar Excel</span>
          </button>

          <button
            onClick={handleOpenAdd}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 transition cursor-pointer shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            <span>Nuevo Inversionista</span>
          </button>
        </div>
      </div>

      {/* Selector de Ventanas de Bitácoras */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Ventana Azul */}
        {(() => {
          const azulUsers = allUsers.filter((u) => u.role === 'USER' && u.category === 'AZUL');
          const azulCap = azulUsers.reduce((sum, u) => sum + u.currentCapital, 0);
          const isSelected = selectedCategory === 'AZUL';
          return (
            <button
              onClick={() => setSelectedCategory('AZUL')}
              className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                isSelected
                  ? 'bg-blue-950/80 border-blue-500 text-blue-100 shadow-lg shadow-blue-500/20 ring-1 ring-blue-500'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <span className="font-extrabold text-xs">Ventana Azul</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-950 border border-blue-500/30 text-blue-300">
                  {azulUsers.length} Users
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(azulCap)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">$4.000.000 a &lt;$10.000.000 COP</p>
            </button>
          );
        })()}

        {/* Ventana Verde */}
        {(() => {
          const verdeUsers = allUsers.filter((u) => u.role === 'USER' && u.category === 'VERDE');
          const verdeCap = verdeUsers.reduce((sum, u) => sum + u.currentCapital, 0);
          const isSelected = selectedCategory === 'VERDE';
          return (
            <button
              onClick={() => setSelectedCategory('VERDE')}
              className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                isSelected
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-100 shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-500'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="font-extrabold text-xs">Ventana Verde</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/30 text-emerald-300">
                  {verdeUsers.length} Users
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(verdeCap)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">$10.000.000 a &lt;$60.000.000 COP</p>
            </button>
          );
        })()}

        {/* Ventana Negra */}
        {(() => {
          const negraUsers = allUsers.filter((u) => u.role === 'USER' && u.category === 'NEGRA');
          const negraCap = negraUsers.reduce((sum, u) => sum + u.currentCapital, 0);
          const isSelected = selectedCategory === 'NEGRA';
          return (
            <button
              onClick={() => setSelectedCategory('NEGRA')}
              className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                isSelected
                  ? 'bg-slate-800 border-slate-400 text-slate-100 shadow-lg shadow-slate-500/20 ring-1 ring-slate-400'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                  <span className="font-extrabold text-xs">Ventana Negra / Whale</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 border border-slate-600 text-slate-300">
                  {negraUsers.length} Users
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(negraCap)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">$60.000.000 a $4.000.000.000 COP</p>
            </button>
          );
        })()}

        {/* Todas las Ventanas */}
        {(() => {
          const totalUsers = allUsers.filter((u) => u.role === 'USER');
          const totalCap = totalUsers.reduce((sum, u) => sum + u.currentCapital, 0);
          const isSelected = selectedCategory === 'ALL';
          return (
            <button
              onClick={() => setSelectedCategory('ALL')}
              className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                isSelected
                  ? 'bg-indigo-950/80 border-indigo-500 text-indigo-100 shadow-lg shadow-indigo-500/20 ring-1 ring-indigo-500'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs">🪟</span>
                  <span className="font-extrabold text-xs">Todas las Ventanas</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-500/30 text-indigo-300">
                  {totalUsers.length} Total
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-mono">{formatCOP(totalCap)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Vista global de inversionistas</p>
            </button>
          );
        })()}
      </div>

      {/* Filters Bar */}
      <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, código (USR-XXXXX), email o teléfono..."
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-xs text-slate-400 shrink-0 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Estado:
          </span>
          {['ALL', 'ACTIVE', 'INACTIVE'].map((st) => (
            <button
              key={st}
              onClick={() => setSelectedStatus(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                selectedStatus === st
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {st === 'ALL' ? 'Todos' : st === 'ACTIVE' ? 'Activos' : 'Inactivos'}
            </button>
          ))}
        </div>
      </div>

      {/* Users Window Container */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
        {/* Terminal Header Bar */}
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/90" />
              <div className="w-3 h-3 rounded-full bg-amber-500/90" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/90" />
            </div>
            <span className="text-xs font-mono font-bold text-slate-300">
              {selectedCategory === 'ALL'
                ? 'VENTANA GLOBAL // TODOS LOS INVERSIONISTAS'
                : `VENTANA OPERATIVA // BITÁCORA ${selectedCategory}`}
            </span>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {filteredUsers.length} registros listados
          </span>
        </div>
        {/* Mobile View: Cards (block md:hidden) */}
        <div className="block md:hidden divide-y divide-slate-800/70">
          {filteredUsers.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-xs">
              No se encontraron inversionistas con los filtros seleccionados.
            </div>
          ) : (
            filteredUsers.map((user) => (
              <div key={user.id} className="p-4 space-y-3 hover:bg-slate-950/40 transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-bold text-blue-400 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-500/20 text-xs">
                      {user.userCode}
                    </span>
                    <div>
                      <h4 className="font-bold text-slate-100 text-sm leading-tight">{user.fullName}</h4>
                      <span className="text-[11px] text-slate-400 font-mono">{user.email}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenEdit(user)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
                    title="Editar inversionista"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 uppercase block font-semibold">Capital Snapshot</span>
                    <span className="font-mono font-black text-slate-100 text-sm mt-0.5 block">
                      {formatCOP(user.currentCapital)}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex flex-col justify-center">
                    <span className="text-[10px] text-slate-500 uppercase block font-semibold">Bitácora / Split</span>
                    <div className="flex items-center justify-between mt-0.5">
                      <span
                        className={`text-[10px] font-bold font-mono px-1.5 py-0.2 rounded ${
                          user.category === 'AZUL'
                            ? 'bg-blue-950 text-blue-300'
                            : user.category === 'VERDE'
                            ? 'bg-emerald-950 text-emerald-300'
                            : 'bg-slate-800 text-slate-200'
                        }`}
                      >
                        {user.category === 'AZUL' ? '🔵 Azul' : user.category === 'VERDE' ? '🟢 Verde' : '⚫ Negra'}
                      </span>
                      <span className="font-mono font-bold text-emerald-400 text-[11px]">
                        {user.userPercentage}% / {user.adminPercentage}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                  <div className="flex items-center gap-1.5 truncate max-w-[150px]">
                    <span className="font-semibold text-slate-300">{user.paymentMethod}:</span>
                    <span className="font-mono truncate">{user.paymentDetails}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleCopyWhatsAppAccess(user)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                        copiedUserId === user.id
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                          : 'bg-slate-900 hover:bg-slate-800 text-emerald-400 border-emerald-500/30'
                      }`}
                      title="Copiar datos de acceso para WhatsApp"
                    >
                      {copiedUserId === user.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>¡Copiado!</span>
                        </>
                      ) : (
                        <>
                          <MessageCircle className="w-3 h-3 text-emerald-400" />
                          <span>WhatsApp</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleOpenEdit(user)}
                      className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
                      title="Editar inversionista"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setUserToDelete(user)}
                      className="p-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-400 border border-rose-800/40 transition cursor-pointer"
                      title="Eliminar inversionista"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold font-mono ${
                        user.status === 'ACTIVE'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {user.status === 'ACTIVE' ? 'Activo' : user.status}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop View: Full Table (hidden md:block) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="pb-3 px-3">Código</th>
                <th className="pb-3 px-3">Inversionista</th>
                <th className="pb-3 px-3">Bitácora / Rango</th>
                <th className="pb-3 px-3">Capital Actual</th>
                <th className="pb-3 px-3">Split Acordado</th>
                <th className="pb-3 px-3">Datos Bancarios</th>
                <th className="pb-3 px-3">Estado</th>
                <th className="pb-3 px-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-950/40 transition">
                  {/* Code */}
                  <td className="py-3.5 px-3">
                    <span className="font-mono font-bold text-blue-400 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-500/20 text-xs">
                      {user.userCode}
                    </span>
                  </td>

                  {/* Name & Contact */}
                  <td className="py-3.5 px-3">
                    <p className="font-bold text-slate-100 text-sm">{user.fullName}</p>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3 text-slate-500" /> {user.email}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-500" /> {user.phone}
                      </span>
                    </div>
                  </td>

                  {/* Bitácora */}
                  <td className="py-3.5 px-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold font-mono text-[11px] border ${
                        user.category === 'AZUL'
                          ? 'bg-blue-950 text-blue-300 border-blue-500/40'
                          : user.category === 'VERDE'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40'
                          : 'bg-slate-800 text-slate-200 border-slate-600'
                      }`}
                    >
                      {user.category === 'AZUL' ? '🔵 Azul' : user.category === 'VERDE' ? '🟢 Verde' : '⚫ Negra'}
                    </span>
                  </td>

                  {/* Capital */}
                  <td className="py-3.5 px-3 font-mono font-bold text-slate-100 text-sm">
                    {formatCOP(user.currentCapital)}
                  </td>

                  {/* Split */}
                  <td className="py-3.5 px-3 font-mono font-bold">
                    <span className="text-emerald-400">{user.userPercentage}% Inversionista</span>
                    <span className="text-slate-500 mx-1">/</span>
                    <span className="text-amber-400">{user.adminPercentage}% Admin</span>
                  </td>

                  {/* Bank */}
                  <td className="py-3.5 px-3 text-slate-300 text-[11px]">
                    <p className="font-semibold text-slate-200">{user.paymentMethod}</p>
                    <p className="font-mono text-slate-400">{user.paymentDetails}</p>
                  </td>

                  {/* Status & Activation */}
                  <td className="py-3.5 px-3">
                    <div className="space-y-1">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold font-mono ${
                          user.status === 'ACTIVE'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {user.status === 'ACTIVE' ? 'Activo' : user.status}
                      </span>
                      <div>
                        {user.isClaimed ? (
                          <span className="text-[10px] text-emerald-400/90 font-mono flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" /> Clave Activa
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-amber-400 shrink-0" /> Por Activar
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleCopyWhatsAppAccess(user)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                          copiedUserId === user.id
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                            : 'bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 border-emerald-500/30'
                        }`}
                        title="Copiar mensaje de bienvenida y datos de activación para enviar por WhatsApp"
                      >
                        {copiedUserId === user.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>¡Copiado!</span>
                          </>
                        ) : (
                          <>
                            <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Enviar Acceso</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => handleOpenEdit(user)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
                        title="Editar inversionista"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setUserToDelete(user)}
                        className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-400 hover:text-rose-300 border border-rose-800/50 transition cursor-pointer"
                        title="Eliminar inversionista"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: Add / Edit User */}
      {(isAddModalOpen || editingUser) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-100 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setIsAddModalOpen(false);
                setEditingUser(null);
              }}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">
                  {editingUser ? `Editar: ${editingUser.fullName}` : 'Registrar Nuevo Inversionista'}
                </h3>
                <p className="text-xs text-slate-400">
                  {editingUser ? `Código: ${editingUser.userCode}` : 'Configuración de capital, bitácora y split'}
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Nombre Completo</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="ej: Diana Marcela Torres"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Correo Electrónico</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="cliente@email.com"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Teléfono / WhatsApp</label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="+57 300 000 0000"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Contraseña Inicial (Para Firebase Auth)
                  </label>
                  <input
                    type="text"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="Contraseña inicial min 6 caracteres"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                    required
                    minLength={6}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Esta contraseña registrará automáticamente al usuario en Firebase Authentication para que pueda iniciar sesión.
                  </p>
                </div>
              )}

              {/* Capital & Dynamic Category Box */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="block text-xs font-semibold text-slate-300">Capital de Inversión (COP)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-slate-400">$</span>
                  <input
                    type="number"
                    step="100000"
                    min="4000000"
                    max="4000000000"
                    value={formCapital}
                    onChange={(e) => setFormCapital(e.target.value)}
                    placeholder="8000000"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-slate-100 font-mono font-bold text-sm focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-400">Bitácora Asignada Automáticamente:</span>
                  <span
                    className={`px-2 py-0.5 rounded font-mono font-bold ${
                      detectedCategory === 'AZUL'
                        ? 'bg-blue-950 text-blue-300 border border-blue-500/40'
                        : detectedCategory === 'VERDE'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-200 border border-slate-600'
                    }`}
                  >
                    {detectedCategory === 'AZUL' ? '🔵 Azul ($4M - <$10M)' : detectedCategory === 'VERDE' ? '🟢 Verde ($10M - <$60M)' : '⚫ Negra ($60M+)'}
                  </span>
                </div>
              </div>

              {/* Split Distribution */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">Reparto de Rentabilidad (Split %)</label>
                  <span className="text-xs text-slate-400 font-mono">Suma obligatoria: 100%</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] text-emerald-400 font-semibold">% Inversionista:</span>
                    <input
                      type="number"
                      min="1"
                      max="99"
                      value={formUserSplit}
                      onChange={(e) => setFormUserSplit(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-emerald-300 font-mono font-bold text-sm mt-1 focus:outline-none focus:border-emerald-500"
                      required
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-amber-400 font-semibold">% Administrador:</span>
                    <input
                      type="number"
                      disabled
                      value={adminSplit}
                      className="w-full bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-1.5 text-amber-300 font-mono font-bold text-sm mt-1"
                    />
                  </div>
                </div>
              </div>

              {/* Bank Details */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Banco / Billetera</label>
                  <select
                    value={formBank}
                    onChange={(e) => setFormBank(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="Bancolombia">Bancolombia</option>
                    <option value="Nequi">Nequi</option>
                    <option value="Davivienda">Davivienda</option>
                    <option value="Llaves (Bre-B / Transfiya)">Llaves (Bre-B / Transfiya)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Número de Cuenta</label>
                  <input
                    type="text"
                    value={formAccount}
                    onChange={(e) => setFormAccount(e.target.value)}
                    placeholder="1234567890"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {formError && (
                <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setEditingUser(null);
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-xl transition disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-lg shadow-blue-600/30 transition cursor-pointer flex items-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Procesando...</span>
                    </>
                  ) : editingUser ? (
                    'Guardar Cambios'
                  ) : (
                    'Registrar Inversionista'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel Bitacora / User Import Modal */}
      <ExcelBitacoraImportModal
        isOpen={isExcelModalOpen}
        onClose={() => setIsExcelModalOpen(false)}
        defaultCategory={selectedCategory !== 'ALL' ? (selectedCategory as BitacoraCategory) : undefined}
      />

      {/* Confirmation Modal: Delete User */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-extrabold text-slate-100">¿Eliminar Inversionista?</h3>
              <p className="text-xs text-slate-300 mt-2">
                Esta acción eliminará permanentemente a <strong className="text-rose-400">{userToDelete.fullName}</strong> ({userToDelete.userCode}) tanto de la base de datos Firestore como de la plataforma.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={isDeletingUser}
                onClick={() => setUserToDelete(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeletingUser}
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {isDeletingUser ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Eliminando...</span>
                  </>
                ) : (
                  'Sí, Eliminar'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
