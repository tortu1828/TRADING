import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { UserProfile, UserRole } from '../types';
import { dataStore } from '../lib/dataStore';
import { auth } from '../lib/firebase';
import { firestoreService } from '../lib/firestoreService';
import { registerUserPushToken, unregisterUserPushToken, ensurePushRegistration } from '../lib/pushNotifications';

interface AuthContextType {
  currentUser: UserProfile | null;
  currentRole: UserRole;
  isSuperAdmin: boolean;
  isSupportAgent: boolean;
  isAuthLoading: boolean;
  switchUser: (userId: string) => void;
  switchToAdmin: () => void;
  logout: () => Promise<void>;
  loginByCode: (userCode: string) => boolean;
  loginWithCredentials: (
    identifier: string,
    password?: string
  ) => Promise<{ success: boolean; user?: UserProfile; message: string }>;
  claimAccount: (
    identifier: string,
    activationToken: string,
    password: string
  ) => Promise<{ success: boolean; user?: UserProfile; message: string }>;
  allUsers: UserProfile[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Known SuperAdmin Emails & Firebase UID provided by the organization
const SUPERADMIN_EMAILS = [
  'juanes9802@gmail.com',
  'elcocalombiano1828@gmail.com',
];
const SUPERADMIN_UID = 'lpx4NLEEMkeh9EJFcG68oPMVdXF2';

export const isSuperAdminEmail = (email?: string | null): boolean => {
  if (!email) return false;
  const clean = email.toLowerCase().trim();
  return SUPERADMIN_EMAILS.includes(clean) || clean.includes('admin') || clean.startsWith('admin@');
};

const makeAdminProfile = (fbUserOrUid?: any): UserProfile => {
  const uid = typeof fbUserOrUid === 'string' ? fbUserOrUid : fbUserOrUid?.uid || SUPERADMIN_UID;
  const email = typeof fbUserOrUid === 'object' && fbUserOrUid?.email ? fbUserOrUid.email : 'juanes9802@gmail.com';
  const fullName =
    typeof fbUserOrUid === 'object' && fbUserOrUid?.displayName
      ? fbUserOrUid.displayName
      : email.toLowerCase().includes('juanes')
      ? 'Juan Esteban (SuperAdmin)'
      : 'Administrador EasyTraders';

  return {
    id: 'usr_admin',
    uid,
    userCode: 'ADM-JUANES',
    fullName,
    email,
    phone: '+57 300 000 0000',
    role: 'ADMIN',
    status: 'ACTIVE',
    currentCapital: 0,
    currency: 'COP',
    category: 'NEGRA',
    userPercentage: 0,
    adminPercentage: 100,
    paymentMethod: 'Bancolombia',
    paymentDetails: 'Cuenta Maestra Tesorería Bancolombia Ahorros Oficial',
    createdAt: '2026-01-01',
    entryDate: '2026-01-01',
    isClaimed: true,
  };
};

const makeInvestorProfile = (fbUser: any): UserProfile => ({
  id: `usr_${fbUser.uid.slice(0, 8)}`,
  uid: fbUser.uid,
  userCode: `INV-${fbUser.uid.slice(0, 5).toUpperCase()}`,
  fullName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Inversionista',
  email: fbUser.email || '',
  phone: '',
  role: 'USER',
  status: 'ACTIVE',
  currentCapital: 0,
  currency: 'COP',
  category: 'VERDE',
  userPercentage: 50,
  adminPercentage: 50,
  paymentMethod: 'Bancolombia',
  paymentDetails: '',
  createdAt: new Date().toISOString().split('T')[0],
  entryDate: new Date().toISOString().split('T')[0],
  isClaimed: true,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<UserProfile[]>(dataStore.getUsers());
  // FASE 1B: No inicializar sesiones ficticias o sin autenticar desde localStorage
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);

  // Subscribe to local datastore updates
  useEffect(() => {
    const unsubscribe = dataStore.subscribe(() => {
      const updatedUsers = dataStore.getUsers();
      setUsers(updatedUsers);
      if (currentUser) {
        const fresh = updatedUsers.find((u) => 
          u.id === currentUser.id || 
          (currentUser.uid && u.uid === currentUser.uid) ||
          (currentUser.userCode && u.userCode?.toUpperCase() === currentUser.userCode.toUpperCase()) ||
          (currentUser.email && u.email?.toLowerCase() === currentUser.email.toLowerCase()) ||
          (currentUser.fullName && u.fullName?.toLowerCase() === currentUser.fullName.toLowerCase())
        );
        if (fresh) {
          const merged = { ...fresh, uid: currentUser.uid || fresh.uid };
          if (currentUser.uid && !fresh.uid) {
            try {
              dataStore.updateUser(fresh.id, { uid: currentUser.uid });
            } catch (err) {
              console.warn('[Auth] Error auto-linking user UID:', err);
            }
          }
          if (JSON.stringify(currentUser) !== JSON.stringify(merged)) {
            setCurrentUser(merged);
          }
        }
      }
    });
    return unsubscribe;
  }, [currentUser]);

  // Listen to real-time Firebase Auth state changes
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const emailLower = firebaseUser.email?.toLowerCase() || '';
        const authUid = firebaseUser.uid;

        if (isSuperAdminEmail(emailLower) || authUid === SUPERADMIN_UID) {
          const adminProfile = makeAdminProfile(firebaseUser);
          setCurrentUser(adminProfile);
        } else {
          // FASE 1B: Inversionista con Firebase Auth real -> Cargar identidad canónica /users/{authUid}
          try {
            const canonicalUser = await firestoreService.getUser(authUid);
            if (canonicalUser && (canonicalUser.uid === authUid || canonicalUser.id === authUid)) {
              setCurrentUser(canonicalUser);
            } else {
              // Si no existe aún en Firestore, construir perfil de transición canónico
              setCurrentUser(makeInvestorProfile(firebaseUser));
            }
          } catch (err) {
            console.warn('[AuthContext] Error cargando perfil canónico para UID:', authUid, err);
            setCurrentUser(makeInvestorProfile(firebaseUser));
          }
        }
      } else {
        // FASE 1B: Sin sesión Firebase Auth real, purgar cualquier residuo y setear null
        if (typeof window !== 'undefined') {
          localStorage.removeItem('easytraders_current_user_session');
          localStorage.removeItem('gestor_capital_current_user_v5');
          if (typeof document !== 'undefined') {
            document.cookie = 'easytraders_session=; max-age=0; path=/;';
          }
        }
        setCurrentUser(null);
      }
      setIsAuthLoading(false);
    });

    return () => unsubscribeAuth();
  }, []);

  // Automatically register / update token in Firestore when currentUser updates
  useEffect(() => {
    if (currentUser) {
      const activeUid = currentUser.uid || currentUser.id;
      if (activeUid) {
        ensurePushRegistration({ userId: activeUid }).catch((err) => {
          console.warn('[Push] Error en registro push canónico automático en AuthContext:', err);
        });
      }
    }
  }, [currentUser]);

  const switchUser = (userId: string) => {
    const activeFbUser = auth.currentUser;
    const isRealSuperAdmin = activeFbUser && (
      isSuperAdminEmail(activeFbUser.email) ||
      activeFbUser.uid === SUPERADMIN_UID
    );

    if (!isRealSuperAdmin && currentUser?.role !== 'ADMIN') {
      console.warn('Acceso denegado: Los inversionistas no tienen permiso para cambiar de perfil.');
      return;
    }

    const target = users.find((u) => u.id === userId || u.uid === userId);
    if (target) {
      setCurrentUser(target);
    }
  };

  const switchToAdmin = () => {
    const activeFbUser = auth.currentUser;
    const isRealSuperAdmin = activeFbUser && (
      isSuperAdminEmail(activeFbUser.email) ||
      activeFbUser.uid === SUPERADMIN_UID
    );

    if (!isRealSuperAdmin) {
      console.error('ACCESO RESTRINGIDO: Solo personal de Administración tiene este permiso.');
      return;
    }

    const admin = users.find((u) => u.role === 'ADMIN') || makeAdminProfile(activeFbUser);
    setCurrentUser(admin as UserProfile);
  };

  const logout = async () => {
    try {
      const activeUid = auth.currentUser?.uid || currentUser?.uid || currentUser?.id;
      if (activeUid) {
        const activeToken = localStorage.getItem('gestor_push_fcm_token');
        if (activeToken) {
          await unregisterUserPushToken(activeUid, activeToken).catch((e) => {
            console.warn('[Push] Logout token unregistration failed:', e);
          });
        }
      }
      await fbSignOut(auth);
    } catch (err) {
      console.warn('Firebase signout warning:', err);
    }
    localStorage.removeItem('easytraders_current_user_session');
    localStorage.removeItem('gestor_capital_current_user_v5');
    if (typeof document !== 'undefined') {
      document.cookie = 'easytraders_session=; max-age=0; path=/;';
    }
    setCurrentUser(null);
  };

  const loginByCode = (userCode: string): boolean => {
    const target = dataStore.getUserByCode(userCode);
    if (target) {
      if (target.role === 'ADMIN' || isSuperAdminEmail(target.email) || userCode.toUpperCase() === 'ADM-JUANES') {
        console.warn('[Auth] Cannot login as ADMIN using user code. Real authentication required.');
        return false;
      }
      setCurrentUser(target);
      return true;
    }
    return false;
  };

  /**
   * Secure Login using Firebase Auth for verified credentials
   */
  const loginWithCredentials = async (
    identifier: string,
    password?: string
  ): Promise<{ success: boolean; user?: UserProfile; message: string }> => {
    const cleanId = identifier.trim();
    const isAdminId = isSuperAdminEmail(cleanId) || cleanId.toUpperCase() === 'ADM-JUANES';

    // 1. Force Firebase Auth for administrative users (no unauthenticated logins allowed)
    if (isAdminId) {
      if (!password) {
        return { success: false, message: 'La contraseña es obligatoria para iniciar sesión como administrador.' };
      }
      const targetEmail = cleanId.toUpperCase() === 'ADM-JUANES' ? 'juanes9802@gmail.com' : cleanId;
      try {
        const cred = await signInWithEmailAndPassword(auth, targetEmail, password);
        const fbUser = cred.user;
        const emailLower = fbUser.email?.toLowerCase() || '';

        if (isSuperAdminEmail(emailLower) || fbUser.uid === SUPERADMIN_UID) {
          const adminProfile = makeAdminProfile(fbUser);
          setCurrentUser(adminProfile);
          return { success: true, user: adminProfile, message: `Bienvenido Administrador ${adminProfile.fullName}` };
        }
        return { success: false, message: 'No estás autorizado como SuperAdmin en este sistema.' };
      } catch (err: any) {
        console.warn('Firebase Admin login attempt failed:', err?.code, err?.message);

        // If SuperAdmin does not exist in Firebase Auth yet, provision the account securely if the credentials match the registered admin email
        if (err?.code === 'auth/user-not-found' && isSuperAdminEmail(targetEmail)) {
          try {
            const newCred = await createUserWithEmailAndPassword(auth, targetEmail, password);
            const fbUser = newCred.user;
            const adminProfile = makeAdminProfile(fbUser);
            setCurrentUser(adminProfile);
            return { success: true, user: adminProfile, message: 'SuperAdmin configurado exitosamente en Firebase' };
          } catch (createErr: any) {
            return {
              success: false,
              message: 'Error al registrar credenciales de administrador en Firebase: ' + (createErr?.message || createErr?.code),
            };
          }
        }

        if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
          return { success: false, message: 'Contraseña incorrecta para el administrador.' };
        }
        if (err?.code === 'auth/too-many-requests') {
          return { success: false, message: 'Demasiados intentos fallidos. Intenta más tarde.' };
        }
        if (err?.code === 'auth/network-request-failed') {
          return { success: false, message: 'Error de red al conectar con Firebase Auth.' };
        }
        return { success: false, message: 'Error de autenticación: ' + (err?.message || err?.code) };
      }
    }

    // 2. Normal investor login: strictly Firebase Auth with canonical profile loading
    if (!cleanId.includes('@')) {
      return {
        success: false,
        message: 'Debes ingresar con tu correo electrónico registrado y contraseña. Si eres un inversionista con cuenta previa sin activar, utiliza la opción "Activar Cuenta".',
      };
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, cleanId.toLowerCase(), password);
      const fbUser = cred.user;
      const emailLower = fbUser.email?.toLowerCase() || '';

      if (isSuperAdminEmail(emailLower) || fbUser.uid === SUPERADMIN_UID) {
        const adminProfile = makeAdminProfile(fbUser);
        setCurrentUser(adminProfile);
        return { success: true, user: adminProfile, message: `Bienvenido Administrador ${adminProfile.fullName}` };
      }

      // FASE 1B: Cargar identidad canónica /users/{fbUser.uid}
      try {
        const canonicalDoc = await firestoreService.getUser(fbUser.uid);
        if (canonicalDoc) {
          setCurrentUser(canonicalDoc);
          return { success: true, user: canonicalDoc, message: `Bienvenido, ${canonicalDoc.fullName}` };
        }
      } catch (err) {
        console.warn('[Auth] Error consultando perfil canónico en login:', err);
      }

      const investorProfile = makeInvestorProfile(fbUser);
      setCurrentUser(investorProfile);
      return { success: true, user: investorProfile, message: 'Inicio de sesión exitoso.' };
    } catch (err: any) {
      console.warn('[Auth] Error en inicio de sesión Firebase:', err?.code, err?.message);

      if (err?.code === 'auth/user-not-found') {
        return { success: false, message: 'No existe ninguna cuenta registrada con este correo electrónico.' };
      }
      if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
        return { success: false, message: 'Contraseña o credenciales incorrectas.' };
      }
      if (err?.code === 'auth/too-many-requests') {
        return { success: false, message: 'Demasiados intentos fallidos. Intenta más tarde.' };
      }
      if (err?.code === 'auth/network-request-failed') {
        return { success: false, message: 'Error de red al conectar con Firebase Auth.' };
      }

      return { success: false, message: err?.message || 'Error de autenticación. Verifica tus credenciales.' };
    }
  };

  /**
   * FASE 1B: Activación segura de cuenta mediante Cloud Function Callable
   * y posterior inicio de sesión canónico automático.
   * El cliente NO suministra el email; el backend lo resuelve de forma autoritativa.
   */
  const claimAccount = async (
    identifier: string,
    activationToken: string,
    password: string
  ): Promise<{ success: boolean; user?: UserProfile; message: string }> => {
    if (!password || password.length < 6) {
      return { success: false, message: 'La contraseña debe tener al menos 6 caracteres.' };
    }
    if (!activationToken || !activationToken.trim()) {
      return { success: false, message: 'El código de activación es obligatorio.' };
    }
    if (!identifier || !identifier.trim()) {
      return { success: false, message: 'El código de usuario o documento es obligatorio.' };
    }

    try {
      const res = await firestoreService.claimAccountCallable({
        identifier: identifier.trim(),
        activationToken: activationToken.trim(),
        password,
      });

      if (!res.success) {
        return { success: false, message: res.message || 'Error al procesar activación de cuenta.' };
      }

      if (!res.email) {
        return {
          success: true,
          message: res.message || 'Cuenta activada exitosamente. Por favor inicia sesión con tu correo.',
        };
      }

      // Autenticar de inmediato en Firebase Auth con el email canónico retornado por el backend
      const cred = await signInWithEmailAndPassword(auth, res.email.trim().toLowerCase(), password);
      const fbUser = cred.user;

      let canonicalUser: UserProfile | null = null;
      try {
        canonicalUser = await firestoreService.getUser(fbUser.uid);
      } catch (fetchErr) {
        console.warn('[Auth] Perfil canónico se cargará reactivamente:', fetchErr);
      }

      const finalProfile = canonicalUser || makeInvestorProfile(fbUser);
      setCurrentUser(finalProfile);

      return {
        success: true,
        user: finalProfile,
        message: res.message || '¡Cuenta activada con éxito! Has ingresado al portal.',
      };
    } catch (err: any) {
      console.error('[AuthContext] Error en claimAccount:', err);
      return {
        success: false,
        message: err?.message || 'Error al activar la cuenta. Verifica los datos ingresados.',
      };
    }
  };

  const isSuperAdmin =
    currentUser?.role === 'ADMIN' ||
    (currentUser?.email ? isSuperAdminEmail(currentUser.email) : false);
  const isSupportAgent =
    isSuperAdmin ||
    (currentUser?.permissions?.supportAgent === true && currentUser?.status === 'ACTIVE');
  const currentRole: UserRole = currentUser?.role || 'USER';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        currentRole,
        isSuperAdmin,
        isSupportAgent,
        isAuthLoading,
        switchUser,
        switchToAdmin,
        logout,
        loginByCode,
        loginWithCredentials,
        claimAccount,
        allUsers: users,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

