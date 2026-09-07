import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics, isSupported } from 'firebase/analytics';

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
export const db = getFirestore(app);

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

export default app;
