/**
 * Firebase 網頁設定。
 *
 * 這組值本來就會出現在前端原始碼中，屬於公開資訊，不是密鑰：
 * 真正的防線是 Firestore 安全規則（見 docs/firebase-setup.md），
 * 規則限定每位使用者只能讀寫 users/{自己的 uid} 底下的資料。
 *
 * 取得方式：Firebase 主控台 → 專案設定 → 一般 → 你的應用程式 → 網頁應用程式 → firebaseConfig。
 * 尚未填寫時，系統會維持純本機模式，不會顯示登入功能。
 */
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
