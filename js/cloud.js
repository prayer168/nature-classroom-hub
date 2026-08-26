import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, doc, getDoc, getDocs, collection, setDoc, runTransaction, onSnapshot } from "firebase/firestore";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { store } from "./store.js";
import { sectionNames, readSection, applySection, mergeSection, stableStringify, isAttendanceSection } from "./sync-merge.js";

/**
 * 雲端同步層：Google 登入 + Firestore。
 *
 * 第二階段的兩個重點：
 *
 * 1. 逐區段寫入。每個區段一份文件，出席再依月份分片，只有真的變動的區段才送出。
 *    區段內容以 JSON 字串存放：第一階段永遠整段讀寫、不需要在雲端查詢，
 *    用字串可以完全避開 Firestore 對 undefined、巢狀陣列與鍵名字元的限制。
 *
 * 2. 樂觀並行控制加三方合併。每份文件帶一個 rev，本機記著上次同步到的 rev 與內容（base）。
 *    寫入時在交易裡比對 rev：一致就直接寫；不一致代表別台裝置先寫了，
 *    改用 base/local/remote 三方合併，只有兩邊都動到同一筆才算真衝突。
 *    先前的做法是遠端一有變動就整份覆蓋本機，等於後寫的人把先寫的人蓋掉。
 */

const PUSH_DEBOUNCE = 2000;
const CLOUD_ACTIVE_KEY = "nature-classroom-hub:cloud-active";
const BASE_KEY = "nature-classroom-hub:sync-base";

let app = null;
let auth = null;
let db = null;
let currentUser = null;
let ready = false;
let syncing = false;
let pushTimer = null;
let applyingRemote = false;
let pendingResolution = null;
let unsubscribeIndex = null;
let lastConflicts = [];
let lastError = "";
const listeners = new Set();

/** 這台裝置的識別碼，用來忽略自己造成的雲端變動。 */
const deviceId = (() => {
  const key = "nature-classroom-hub:device";
  let id = localStorage.getItem(key);
  if (!id) { id = `dev-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(key, id); }
  return id;
})();

/**
 * base：上次同步成功時每個區段的內容與 rev。
 * 存在 localStorage 才能跨分頁與重新整理保留，否則每次開頁面都會退化成兩方比對。
 */
function loadBase() {
  try { return JSON.parse(localStorage.getItem(BASE_KEY) || "{}"); } catch { return {}; }
}
function saveBase(base) {
  try { localStorage.setItem(BASE_KEY, JSON.stringify(base)); } catch { /* 空間不足時略過 */ }
}
let syncBase = loadBase();

export const cloudEnabled = isFirebaseConfigured;

export function onCloudState(listener) {
  listeners.add(listener);
  listener(cloudState());
  return () => listeners.delete(listener);
}

function emit() {
  const snapshot = cloudState();
  listeners.forEach(listener => listener(snapshot));
}

export function cloudState() {
  return {
    enabled: cloudEnabled,
    ready,
    syncing,
    user: currentUser ? { email: currentUser.email, name: currentUser.displayName } : null,
    pendingResolution,
    conflicts: lastConflicts,
    error: lastError,
    lastSyncedAt: store.get().settings.cloudSyncedAt || null
  };
}

/* ------------------------------------------------------------------ 初始化 */

export function initCloud() {
  if (!cloudEnabled || app) return;
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) })
  });
  onAuthStateChanged(auth, async user => {
    currentUser = user;
    ready = true;
    stopWatching();
    if (user) {
      localStorage.setItem(CLOUD_ACTIVE_KEY, "1");
      await afterSignIn();
    } else {
      localStorage.removeItem(CLOUD_ACTIVE_KEY);
      syncBase = {};
      saveBase(syncBase);
    }
    emit();
  });
  store.subscribe(() => schedulePush());
}

export async function signIn() {
  if (!auth) throw new Error("尚未設定 Firebase。");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error.code === "auth/popup-blocked") throw new Error("瀏覽器擋下了登入視窗，請允許彈出視窗後再試一次。");
    if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") throw new Error("登入視窗被關閉，尚未完成登入。");
    if (error.code === "auth/unauthorized-domain") throw new Error("這個網域尚未加入 Firebase 的已授權網域清單，請到 Authentication → 設定 → 已授權網域新增。");
    throw new Error(`登入失敗：${error.message}`);
  }
}

export async function signOutCloud() {
  if (!auth) return;
  clearTimeout(pushTimer);
  stopWatching();
  await firebaseSignOut(auth);
}

/* --------------------------------------------------------------- 首次歸屬 */

async function afterSignIn() {
  await migrateLegacyCloud();
  const index = await getDoc(indexRef());
  const cloudHasData = index.exists();
  const hasBase = Object.keys(syncBase).length > 0;

  if (!cloudHasData) { await syncNow(true); startWatching(); return; }
  // 這台裝置同步過就直接進入正常合併流程；沒同步過又已有本機資料才需要問。
  if (hasBase || !hasLocalData()) { await syncNow(); startWatching(); return; }
  pendingResolution = {
    cloudUpdatedAt: index.data().updatedAt || "",
    localUpdatedAt: store.get().updatedAt || ""
  };
}

function hasLocalData() {
  const state = store.get();
  return (state.attendanceLog || []).length > 0 ||
    (state.transferLog || []).length > 0 ||
    (state.observations || []).length > 0 ||
    state.students.some(student => student.deletedAt || student.active === false || student.note || (student.tags || []).length);
}

export async function resolveInitialSync(choice) {
  if (!pendingResolution) return;
  pendingResolution = null;
  if (choice === "cloud") {
    syncBase = {};
    await pullAll();
  } else {
    // 以本機為準：把 base 清成空的，合併時本機的每一筆都會被視為新增。
    syncBase = {};
    await syncNow(true);
  }
  startWatching();
  emit();
}

/**
 * 第一階段把資料放在 data/* 與 attendance/*，第二階段改成 sections/* 並加上 rev。
 * 路徑變了，舊資料若不搬過來，換一台沒有本機資料的裝置登入就會看到空的。
 * 只在新結構還沒有東西、而舊結構有資料時搬一次，舊文件保留不刪當備援。
 */
async function migrateLegacyCloud() {
  const existing = await getDocs(collection(db, `${base()}/sections`));
  if (!existing.empty) return;
  const legacyMeta = await getDoc(doc(db, `${base()}/meta/state`));
  if (!legacyMeta.exists()) return;

  const parse = snapshot => (snapshot.exists() ? JSON.parse(snapshot.data().payload || "null") : null);
  const values = {};
  values.meta = JSON.parse(legacyMeta.data().payload || "{}");

  const legacyMap = {
    lessons: ["lessons", data => data?.lessons],
    students: ["students", data => data?.students],
    assessments: ["assessments", data => data?.assessments],
    scores: ["scores", data => data?.scores],
    scoreStatus: ["scores", data => data?.scoreStatus],
    rewardsLedger: ["rewards", data => data?.rewards?.ledger],
    rewardsMenu: ["rewards", data => data?.rewards?.menu],
    observations: ["observations", data => data?.observations],
    resources: ["resources", data => data?.resources],
    attendanceLog: ["logs", data => data?.attendanceLog],
    transferLog: ["logs", data => data?.transferLog]
  };
  const cache = {};
  for (const [name, [docId, pick]] of Object.entries(legacyMap)) {
    cache[docId] ||= parse(await getDoc(doc(db, `${base()}/data/${docId}`)));
    const picked = pick(cache[docId]);
    if (picked !== undefined && picked !== null) values[name] = picked;
  }
  for (const month of legacyMeta.data().months || []) {
    const days = parse(await getDoc(doc(db, `${base()}/attendance/${month}`)));
    if (days) values[`attendance:${month}`] = days;
  }

  for (const [name, value] of Object.entries(values)) {
    const payload = stableStringify(value);
    await setDoc(sectionRef(name), { payload, rev: 1, updatedAt: new Date().toISOString(), deviceId });
    syncBase[name] = { payload, rev: 1 };
  }
  saveBase(syncBase);
  await writeIndex();
}

/* --------------------------------------------------------------- 同步核心 */

function schedulePush() {
  if (!currentUser || applyingRemote || pendingResolution) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { syncNow().catch(reportError); }, PUSH_DEBOUNCE);
}

function reportError(error) {
  lastError = error?.message || String(error);
  console.warn("雲端同步失敗", error);
  emit();
}

/**
 * 推送有變動的區段。每個區段各自一筆交易，一個區段衝突不會擋住其他區段。
 * force 代表忽略「內容沒變」的判斷，整份重送。
 */
export async function syncNow(force = false) {
  if (!currentUser || syncing) return;
  syncing = true;
  lastError = "";
  emit();
  const conflicts = [];
  const mergedSections = [];
  try {
    const state = store.get();
    const names = sectionNames(state);
    for (const name of names) {
      const local = readSection(state, name);
      const baseEntry = syncBase[name];
      const localString = stableStringify(local);
      if (!force && baseEntry && baseEntry.payload === localString) continue;

      const outcome = await pushSection(name, local, baseEntry);
      if (outcome.merged) mergedSections.push({ name, value: outcome.value });
      conflicts.push(...outcome.conflicts.map(item => ({ ...item, section: name })));
    }

    if (mergedSections.length) {
      applyingRemote = true;
      try {
        const next = structuredClone(store.get());
        mergedSections.forEach(item => applySection(next, item.name, item.value));
        store.replace(next);
      } finally { applyingRemote = false; }
    }

    await writeIndex();
    saveBase(syncBase);
    applyingRemote = true;
    try { store.update(draft => { draft.settings.cloudSyncedAt = new Date().toISOString(); }); }
    finally { applyingRemote = false; }
    lastConflicts = conflicts;
  } finally {
    syncing = false;
    emit();
  }
}

/**
 * 單一區段的寫入。交易內比對 rev：
 * 相同代表沒人動過，直接寫；不同就用三方合併，把兩邊的變更都保住。
 */
async function pushSection(name, local, baseEntry) {
  const reference = sectionRef(name);
  const result = { merged: false, value: local, conflicts: [] };

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const remoteRev = snapshot.exists() ? Number(snapshot.data().rev || 0) : 0;
    const baseRev = Number(baseEntry?.rev || 0);

    let value = local;
    let conflicts = [];
    if (snapshot.exists() && remoteRev !== baseRev) {
      const remote = JSON.parse(snapshot.data().payload || "null");
      const base = baseEntry ? JSON.parse(baseEntry.payload) : emptyLike(remote);
      const merged = mergeSection(name, base, local, remote);
      value = merged.value;
      conflicts = merged.conflicts;
      result.merged = true;
      result.value = value;
    }
    result.conflicts = conflicts;

    const payload = stableStringify(value);
    const nextRev = Math.max(remoteRev, baseRev) + 1;
    transaction.set(reference, { payload, rev: nextRev, updatedAt: new Date().toISOString(), deviceId });
    syncBase[name] = { payload, rev: nextRev };
  });

  return result;
}

function emptyLike(remote) {
  return Array.isArray(remote) ? [] : {};
}

/** 讀回雲端所有區段並與本機合併；用於首次登入與手動重新下載。 */
async function pullAll() {
  if (!currentUser) return;
  const snapshots = await getDocs(collection(db, `${base()}/sections`));
  if (snapshots.empty) return;

  const next = structuredClone(store.get());
  const conflicts = [];
  snapshots.forEach(snapshot => {
    const name = snapshot.id.replace(/__/g, ":");
    const remote = JSON.parse(snapshot.data().payload || "null");
    const localValue = readSection(next, name);
    const baseEntry = syncBase[name];
    const baseValue = baseEntry ? JSON.parse(baseEntry.payload) : emptyLike(remote);
    const merged = mergeSection(name, baseValue, localValue, remote);
    applySection(next, name, merged.value);
    conflicts.push(...merged.conflicts.map(item => ({ ...item, section: name })));
    syncBase[name] = { payload: snapshot.data().payload, rev: Number(snapshot.data().rev || 0) };
  });

  applyingRemote = true;
  try {
    store.replace(next);
    store.update(draft => { draft.settings.cloudSyncedAt = new Date().toISOString(); });
  } finally { applyingRemote = false; }
  saveBase(syncBase);
  lastConflicts = conflicts;
  emit();
}

/** 索引文件只記錄「誰在什麼時候寫過」，供其他裝置偵測變動。 */
async function writeIndex() {
  await setDoc(indexRef(), {
    updatedAt: new Date().toISOString(),
    deviceId,
    sections: Object.keys(syncBase)
  });
}

export async function forcePush() { await syncNow(true); }
export async function forcePull() { await pullAll(); }
export function clearConflicts() { lastConflicts = []; emit(); }

/* -------------------------------------------------------- 其他裝置的變動 */

function startWatching() {
  stopWatching();
  if (!currentUser) return;
  unsubscribeIndex = onSnapshot(indexRef(), snapshot => {
    if (!snapshot.exists() || snapshot.metadata.hasPendingWrites) return;
    if (snapshot.data().deviceId === deviceId) return;
    // 別台裝置寫過了。這裡走合併而不是覆蓋，本機未同步的修改不會被吃掉。
    pullAll().catch(reportError);
  });
}

function stopWatching() {
  if (unsubscribeIndex) unsubscribeIndex();
  unsubscribeIndex = null;
}

/* ---------------------------------------------------------------- 路徑 */

function base() { return `users/${currentUser.uid}`; }
function indexRef() { return doc(db, `${base()}/meta/index`); }
/** Firestore 文件 id 不接受冒號，出席分片改用雙底線。 */
function sectionRef(name) { return doc(db, `${base()}/sections/${name.replace(/:/g, "__")}`); }
export { isAttendanceSection };
