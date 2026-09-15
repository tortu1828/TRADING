import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, createUserWithEmailAndPassword, signOut as fbSignOut, sendPasswordResetEmail } from 'firebase/auth';
import { initializeFirestore, getFirestore, Firestore } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getFunctions, httpsCallable } from 'firebase/functions';

export const firebaseConfig = {
  apiKey: "AIzaSyCuDd0HyWMlcUedTMAb3c4Sfjdb4qNkvIc",
  authDomain: "trading-a473e.firebaseapp.com",
  projectId: "trading-a473e",
  storageBucket: "trading-a473e.firebasestorage.app",
  messagingSenderId: "777989829280",
  appId: "1:777989829280:web:fbc3a266cfe2399cf68fc5",
  measurementId: "G-ZK3750YQN2"
};

// Initialize Firebase App
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Initialize Firestore with long-polling to prevent stream 10s connection timeout in iframe and proxies
let firestoreInstance: Firestore;
try {
  firestoreInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  });
} catch {
  firestoreInstance = getFirestore(app);
}
export const db = firestoreInstance;

if (typeof window !== 'undefined') {
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('Firebase setPersistence warning:', err);
  });
}

/**
 * Creates a new user in Firebase Auth without logging out the active Admin session
 */
export async function createFirebaseAuthUser(email: string, pass: string): Promise<string> {
  const secondaryApp = getApps().find((a) => a.name === 'SecondaryAdminWorker') || initializeApp(firebaseConfig, 'SecondaryAdminWorker');
  const secondaryAuth = getAuth(secondaryApp);
  const cred = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), pass);
  const uid = cred.user.uid;
  await fbSignOut(secondaryAuth);
  return uid;
}

/**
 * Sends a password reset email via Firebase Auth
 */
export async function sendFirebasePasswordReset(email: string): Promise<{ success: boolean; message: string }> {
  try {
    await sendPasswordResetEmail(auth, email.trim());
    return {
      success: true,
      message: `Se ha enviado un enlace seguro de restablecimiento al correo: ${email.trim()}. Revisa tu bandeja de entrada o spam.`,
    };
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') {
      return {
        success: false,
        message: 'No existe ningún usuario registrado con este correo electrónico en Firebase.',
      };
    }
    if (err?.code === 'auth/invalid-email') {
      return {
        success: false,
        message: 'El correo electrónico ingresado no es válido.',
      };
    }
    return {
      success: false,
      message: err?.message || 'Error al enviar el correo de restablecimiento.',
    };
  }
}

// Initialize Analytics conditionally
export let analytics: any = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics optional fallback
  });
}

// Initialize Firebase Functions
export const functions = getFunctions(app, 'us-central1');
export { httpsCallable };

export default app;
