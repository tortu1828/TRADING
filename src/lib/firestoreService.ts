import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  UserProfile,
  MonthlyCycle,
  InvestorApplication,
  DailyGroupOperation,
  CycleGroupCalculation,
  CycleUserResult,
  ReinvestmentRequest,
  DisbursementRequest,
  InvestmentRequest,
  NotificationItem,
  AuditLog,
  GlobalConfig,
} from '../types';

export const firestoreService = {
  // --- USUARIOS ---
  async saveUser(user: UserProfile) {
    const userRef = doc(db, 'users', user.id);
    await setDoc(userRef, user, { merge: true });
  },

  async getUser(id: string): Promise<UserProfile | null> {
    const snap = await getDoc(doc(db, 'users', id));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  },

  async getAllUsers(): Promise<UserProfile[]> {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map((d) => d.data() as UserProfile);
  },

  async deleteUser(id: string) {
    await deleteDoc(doc(db, 'users', id));
  },

  // --- CICLOS MENSUALES ---
  async saveCycle(cycle: MonthlyCycle) {
    const cycleRef = doc(db, 'monthlyCycles', cycle.cycleId || cycle.id);
    await setDoc(cycleRef, cycle, { merge: true });
  },

  async getAllCycles(): Promise<MonthlyCycle[]> {
    const snap = await getDocs(collection(db, 'monthlyCycles'));
    return snap.docs.map((d) => d.data() as MonthlyCycle);
  },

  // --- POSTULACIONES FIFO ---
  async saveApplication(app: InvestorApplication) {
    const appRef = doc(db, 'investorApplications', app.id);
    await setDoc(appRef, app, { merge: true });
  },

  async getAllApplications(): Promise<InvestorApplication[]> {
    const snap = await getDocs(collection(db, 'investorApplications'));
    return snap.docs.map((d) => d.data() as InvestorApplication);
  },

  // --- BITÁCORAS / OPERACIONES DIARIAS ---
  async saveDailyOperation(op: DailyGroupOperation) {
    const opRef = doc(db, 'dailyOperations', op.id);
    await setDoc(opRef, op, { merge: true });
  },

  async getAllDailyOperations(): Promise<DailyGroupOperation[]> {
    const snap = await getDocs(collection(db, 'dailyOperations'));
    return snap.docs.map((d) => d.data() as DailyGroupOperation);
  },

  // --- CÁLCULOS Y LIQUIDACIONES ---
  async saveGroupCalculation(calc: CycleGroupCalculation) {
    const calcRef = doc(db, 'cycleGroupCalculations', calc.id);
    await setDoc(calcRef, calc, { merge: true });
  },

  async saveUserResult(result: CycleUserResult) {
    const resRef = doc(db, 'cycleUserResults', result.id);
    await setDoc(resRef, result, { merge: true });
  },

  // --- SOLICITUDES ---
  async saveReinvestment(reinv: ReinvestmentRequest) {
    await setDoc(doc(db, 'reinvestments', reinv.id), reinv, { merge: true });
  },

  async saveDisbursement(disb: DisbursementRequest) {
    await setDoc(doc(db, 'disbursements', disb.id), disb, { merge: true });
  },

  async saveInvestment(inv: InvestmentRequest) {
    await setDoc(doc(db, 'investments', inv.id), inv, { merge: true });
  },

  // --- CONFIGURACIÓN GLOBAL ---
  async saveSettings(config: GlobalConfig) {
    await setDoc(doc(db, 'settings', 'global_config'), config, { merge: true });
  },

  async getSettings(): Promise<GlobalConfig | null> {
    const snap = await getDoc(doc(db, 'settings', 'global_config'));
    return snap.exists() ? (snap.data() as GlobalConfig) : null;
  },

  // --- AUDITORÍA ---
  async logAudit(log: AuditLog) {
    await setDoc(doc(db, 'auditLogs', log.id), log, { merge: true });
  },
};
