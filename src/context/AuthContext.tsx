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

interface AuthContextType {
  currentUser: UserProfile | null;
  currentRole: UserRole;
  isSuperAdmin: boolean;
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
    email: string,
    password?: string
  ) => { success: boolean; user?: UserProfile; message: string };
  allUsers: UserProfile[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Known SuperAdmin Email & Firebase UID provided by the organization
const SUPERADMIN_EMAIL = 'juanes9802@gmail.com';
const SUPERADMIN_UID = 'lpx4NLEEMkeh9EJFcG68oPMVdXF2';

const makeAdminProfile = (fbUserOrUid?: any): UserProfile => {
  const uid = typeof fbUserOrUid === 'string' ? fbUserOrUid : fbUserOrUid?.uid || SUPERADMIN_UID;
  const email = typeof fbUserOrUid === 'object' && fbUserOrUid?.email ? fbUserOrUid.email : SUPERADMIN_EMAIL;
  return {
    id: 'usr_admin',
    uid,
    userCode: 'ADMIN-JUANES',
    fullName: 'Juan Esteban (SuperAdmin)',
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
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);

  // Subscribe to local datastore updates
  useEffect(() => {
    const unsubscribe = dataStore.subscribe(() => {
      const updatedUsers = dataStore.getUsers();
      setUsers(updatedUsers);
      if (currentUser) {
        const fresh = updatedUsers.find((u) => u.id === currentUser.id || u.uid === currentUser.uid);
        if (fresh) {
          setCurrentUser(fresh);
        }
      }
    });
    return unsubscribe;
  }, [currentUser]);

  // Listen to real-time Firebase Auth state changes
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        const emailLower = firebaseUser.email?.toLowerCase() || '';
        if (emailLower === SUPERADMIN_EMAIL || firebaseUser.uid === SUPERADMIN_UID) {
          const adminProfile = makeAdminProfile(firebaseUser);
          setCurrentUser(adminProfile);
        } else {
          // Check if user is a registered investor
          const investor = dataStore.getUsers().find(
            (u) => u.email?.toLowerCase() === emailLower || u.uid === firebaseUser.uid
          );
          if (investor) {
            setCurrentUser({ ...investor, uid: firebaseUser.uid });
          } else {
            // General investor session
            setCurrentUser(makeInvestorProfile(firebaseUser));
          }
        }
      } else {
        // Logged out
        setCurrentUser(null);
      }
      setIsAuthLoading(false);
    });

    return () => unsubscribeAuth();
  }, []);

  const switchUser = (userId: string) => {
    const activeFbUser = auth.currentUser;
    const isRealSuperAdmin = activeFbUser && (
      activeFbUser.email?.toLowerCase() === SUPERADMIN_EMAIL ||
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
      activeFbUser.email?.toLowerCase() === SUPERADMIN_EMAIL ||
      activeFbUser.uid === SUPERADMIN_UID
    );

    if (!isRealSuperAdmin) {
      console.error('ACCESO RESTRENGIDO: Un inversionista no puede cambiar al rol de Administrador.');
      return;
    }

    const admin = users.find((u) => u.role === 'ADMIN') || makeAdminProfile(activeFbUser);
    setCurrentUser(admin as UserProfile);
  };

  const logout = async () => {
    try {
      await fbSignOut(auth);
    } catch (err) {
      console.warn('Firebase signout warning:', err);
    }
    setCurrentUser(null);
  };

  const loginByCode = (userCode: string): boolean => {
    const target = dataStore.getUserByCode(userCode);
    if (target) {
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

    // 1. If an email is provided and password exists, authenticate directly with Firebase Auth
    if (password && cleanId.includes('@')) {
      try {
        const cred = await signInWithEmailAndPassword(auth, cleanId, password);
        const fbUser = cred.user;
        const emailLower = fbUser.email?.toLowerCase() || '';

        if (emailLower === SUPERADMIN_EMAIL || fbUser.uid === SUPERADMIN_UID) {
          const adminProfile = makeAdminProfile(fbUser);
          setCurrentUser(adminProfile);
          return { success: true, user: adminProfile, message: 'Bienvenido SuperAdmin Juan Esteban' };
        }

        // Investor matching
        const matched = dataStore.getUsers().find((u) => u.email?.toLowerCase() === emailLower);
        if (matched) {
          const updated = { ...matched, uid: fbUser.uid };
          setCurrentUser(updated);
          return { success: true, user: updated, message: `Bienvenido, ${updated.fullName}` };
        }

        const newProfile = makeInvestorProfile(fbUser);
        setCurrentUser(newProfile);
        return { success: true, user: newProfile, message: 'Inicio de sesión exitoso.' };
      } catch (err: any) {
        console.warn('Firebase login attempt:', err?.code, err?.message);

        // If user not found in Firebase Auth tenant yet, and it's the admin, create the account securely
        if (err?.code === 'auth/user-not-found' && cleanId.toLowerCase() === SUPERADMIN_EMAIL) {
          try {
            const newCred = await createUserWithEmailAndPassword(auth, cleanId, password);
            const fbUser = newCred.user;
            const adminProfile = makeAdminProfile(fbUser);
            setCurrentUser(adminProfile);
            return { success: true, user: adminProfile, message: 'SuperAdmin configurado exitosamente en Firebase' };
          } catch (createErr: any) {
            return {
              success: false,
              message: 'Error al registrar credenciales en Firebase: ' + (createErr?.message || createErr?.code),
            };
          }
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

        // Return error message if auth fails
        return { success: false, message: err?.message || 'Error en Firebase Authentication.' };
      }
    }

    // 2. Fallback for investor claiming/code login without email
    const res = dataStore.loginWithCredentials(cleanId, password);
    if (res.success && res.user) {
      setCurrentUser(res.user);
    }
    return res;
  };

  const claimAccount = (identifier: string, email: string, password?: string) => {
    const res = dataStore.claimAccount(identifier, email, password);
    if (res.success && res.user) {
      setCurrentUser(res.user);
    }
    return res;
  };

  const isSuperAdmin = currentUser?.role === 'ADMIN';
  const currentRole: UserRole = currentUser?.role || 'USER';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        currentRole,
        isSuperAdmin,
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

