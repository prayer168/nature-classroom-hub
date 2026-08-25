import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, doc, getDoc, setDoc, writeBatch, onSnapshot, serverTimestamp } from "firebase/firestore";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { store } from "./store.js";

/**
 * 雲端同步層：Google 登入 + Firestore。
 *
 * 資料切成幾個「區段」，每個區段一份文件，出席再依月份分片，
 * 避免所有東西擠在同一份文件而撞到 Firestore 單筆 1 MB 上限。
 *
 * 區段內容以 JSON 字串存放。第一階段永遠是整段讀寫，不需要在雲端查詢，
 * 用字串可以完全避開 Firestore 對 undefined、巢狀陣列與鍵名字元的限制。
 * 之後若要做逐筆更新或雲端查詢，再改成結構化欄位。
 */

const SECTIONS = {
  lessons: state => ({ lessons: state.lessons }),
  students: state => ({ students: state.students }),
  assessments: state => ({ assessments: state.assessments }),
  scores: state => ({ scores: state.scores, scoreStatus: state.scoreStatus }),
  rewards: state => ({ rewards: state.rewards }),
  observations: state => ({ observations: state.observations }),
  resources: state => ({ resources: state.resources }),
  logs: state => ({ attendanceLog: state.attendanceLog, transferLog: state.transferLog })
};

const META_FIELDS = ["version", "activeClassId", "settings", "toolHistory"];
const PUSH_DEBOUNCE = 2500;
const CLOUD_ACTIVE_KEY = "nature-classroom-hub:cloud-active";

let app = null;
let auth = null;
let db = null;
let currentUser = null;
let ready = false;

/** 上一次成功推送的各區段內容，用來判斷哪些區段真的變了。 */
let pushedSnapshot = {};
let pushTimer = null;
let applyingRemote = false;
let pendingResolution = null;
let unsubscribeMeta = null;
const listeners = new Set();

/** 這台裝置的識別碼，用來忽略自己造成的雲端變動，避免拉回自己剛寫的東西。 */
const deviceId = (() => {
  const key = "nature-classroom-hub:device";
  let id = localStorage.getItem(key);
  if (!id) { id = `dev-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(key, id); }
  return id;
})();

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
    user: currentUser ? { email: currentUser.email, name: currentUser.displayName, photo: currentUser.photoURL } : null,
    pendingResolution,
    lastSyncedAt: store.get().settings.cloudSyncedAt || null
  };
}

/* ------------------------------------------------------------------ 初始化 */

export function initCloud() {
  if (!cloudEnabled || app) return;
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    // 離線快取：斷網時仍可上課，恢復連線後自動補送。
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) })
  });
  onAuthStateChanged(auth, async user => {
    currentUser = user;
    ready = true;
    stopWatching();
    // 記住這台裝置登入過，其他頁面才知道要載入雲端模組。
    if (user) localStorage.setItem(CLOUD_ACTIVE_KEY, "1");
    else localStorage.removeItem(CLOUD_ACTIVE_KEY);
    if (user) await afterSignIn();
    else pushedSnapshot = {};
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
  const meta = await getDoc(metaRef());
  const cloudHasData = meta.exists();
  const localTouched = hasLocalData();
  if (!cloudHasData) {
    // 雲端還是空的：直接把本機資料當成起點上傳。
    await pushAll();
    startWatching();
    return;
  }
  if (!localTouched) {
    await pullAll();
    startWatching();
    return;
  }
  // 兩邊都有資料，交給使用者決定，不擅自覆蓋任何一邊。
  pendingResolution = {
    cloudUpdatedAt: meta.data().updatedAt || "",
    localUpdatedAt: store.get().updatedAt || ""
  };
}

/** 本機是否有教師實際輸入過的資料（而不只是示範資料）。 */
function hasLocalData() {
  const state = store.get();
  return Boolean(state.settings.cloudSyncedAt) ||
    (state.attendanceLog || []).length > 0 ||
    (state.transferLog || []).length > 0 ||
    (state.observations || []).length > 0 ||
    state.students.some(student => student.deletedAt || student.active === false || student.note || (student.tags || []).length);
}

export async function resolveInitialSync(choice) {
  if (!pendingResolution) return;
  pendingResolution = null;
  if (choice === "cloud") await pullAll();
  else await pushAll(true);
  startWatching();
  emit();
}

/* ------------------------------------------------------------------ 推送 */

function schedulePush() {
  if (!currentUser || applyingRemote || pendingResolution) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushAll().catch(error => console.warn("雲端同步失敗", error)); }, PUSH_DEBOUNCE);
}

async function pushAll(force = false) {
  if (!currentUser) return;
  const state = store.get();
  const batch = writeBatch(db);
  let changed = 0;

  Object.entries(SECTIONS).forEach(([name, pick]) => {
    const payload = JSON.stringify(pick(state));
    if (!force && pushedSnapshot[name] === payload) return;
    batch.set(sectionRef(name), { payload, updatedAt: new Date().toISOString() });
    pushedSnapshot[name] = payload;
    changed += 1;
  });

  Object.entries(attendanceByMonth(state)).forEach(([month, days]) => {
    const payload = JSON.stringify(days);
    const key = `attendance:${month}`;
    if (!force && pushedSnapshot[key] === payload) return;
    batch.set(attendanceRef(month), { payload, updatedAt: new Date().toISOString() });
    pushedSnapshot[key] = payload;
    changed += 1;
  });

  const metaPayload = Object.fromEntries(META_FIELDS.map(field => [field, state[field]]));
  const metaString = JSON.stringify(metaPayload);
  if (force || pushedSnapshot.meta !== metaString || changed) {
    batch.set(metaRef(), {
      payload: metaString,
      months: Object.keys(attendanceByMonth(state)),
      updatedAt: new Date().toISOString(),
      deviceId,
      writtenAt: serverTimestamp()
    });
    pushedSnapshot.meta = metaString;
    changed += 1;
  }

  if (!changed) return;
  await batch.commit();
  applyingRemote = true;
  store.update(draft => { draft.settings.cloudSyncedAt = new Date().toISOString(); });
  applyingRemote = false;
  emit();
}

/* ------------------------------------------------------------------ 拉取 */

async function pullAll() {
  if (!currentUser) return;
  const meta = await getDoc(metaRef());
  if (!meta.exists()) return;
  const next = JSON.parse(meta.data().payload || "{}");
  const months = meta.data().months || [];

  const sections = await Promise.all(Object.keys(SECTIONS).map(async name => [name, await getDoc(sectionRef(name))]));
  sections.forEach(([name, snapshot]) => {
    if (!snapshot.exists()) return;
    Object.assign(next, JSON.parse(snapshot.data().payload || "{}"));
    pushedSnapshot[name] = snapshot.data().payload;
  });

  const attendance = {};
  const monthDocs = await Promise.all(months.map(async month => [month, await getDoc(attendanceRef(month))]));
  monthDocs.forEach(([month, snapshot]) => {
    if (!snapshot.exists()) return;
    Object.assign(attendance, JSON.parse(snapshot.data().payload || "{}"));
    pushedSnapshot[`attendance:${month}`] = snapshot.data().payload;
  });
  next.attendance = attendance;
  pushedSnapshot.meta = meta.data().payload;

  applyingRemote = true;
  try {
    store.replace(next);
    store.update(draft => { draft.settings.cloudSyncedAt = new Date().toISOString(); });
  } finally {
    applyingRemote = false;
  }
  emit();
}

export async function forcePush() { await pushAll(true); emit(); }
export async function forcePull() { await pullAll(); }

/* -------------------------------------------------------- 其他裝置的變動 */

function startWatching() {
  stopWatching();
  if (!currentUser) return;
  unsubscribeMeta = onSnapshot(metaRef(), snapshot => {
    if (!snapshot.exists() || snapshot.metadata.hasPendingWrites) return;
    if (snapshot.data().deviceId === deviceId) return;
    // 另一台裝置寫入了新資料，直接拉回來；本機是快取，以雲端為準。
    pullAll().catch(error => console.warn("讀取雲端更新失敗", error));
  });
}

function stopWatching() {
  if (unsubscribeMeta) unsubscribeMeta();
  unsubscribeMeta = null;
}

/* ---------------------------------------------------------------- 工具 */

function attendanceByMonth(state) {
  const grouped = {};
  Object.entries(state.attendance || {}).forEach(([date, day]) => {
    const month = String(date).slice(0, 7);
    grouped[month] ||= {};
    grouped[month][date] = day;
  });
  return grouped;
}

function base() { return `users/${currentUser.uid}`; }
function metaRef() { return doc(db, `${base()}/meta/state`); }
function sectionRef(name) { return doc(db, `${base()}/data/${name}`); }
function attendanceRef(month) { return doc(db, `${base()}/attendance/${month}`); }
