# Firebase 登入與雲端資料庫設定

登入後，資料以 **Firestore 為主、瀏覽器本機為離線快取**。在任何裝置用同一個 Google 帳號登入，就會看到同一份資料；斷網仍可上課，恢復連線後自動補送。

尚未填入設定前，系統維持純本機模式，設定頁不會顯示登入區塊。

---

## 1. 建立 Firebase 專案

1. 開 [Firebase 主控台](https://console.firebase.google.com/) →「新增專案」，命名例如 `nature-classroom-hub`（Google Analytics 可關閉）。
2. **Authentication** → 開始使用 → 登入方式 → 啟用 **Google** → 儲存。
3. Authentication → **設定 → 已授權網域** → 新增 `prayer168.github.io`。
   （`localhost` 預設就在清單裡，本機開發不用另外加。）
4. **Firestore Database** → 建立資料庫 → 選 **正式版模式** → 位置選 `asia-east1`。
5. 專案設定（齒輪）→ 一般 → 你的應用程式 → 選 **網頁 `</>`** → 註冊應用程式 → 複製 `firebaseConfig`。

## 2. 填入前端設定

把第 5 步的值填進 [`js/firebase-config.js`](../js/firebase-config.js)：

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "nature-classroom-hub.firebaseapp.com",
  projectId: "nature-classroom-hub",
  storageBucket: "nature-classroom-hub.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef"
};
```

> 這組值**不是密鑰**。Firebase 網頁設定本來就會出現在前端原始碼裡，任何人都看得到。
> 真正的防線是下一節的安全規則——沒有規則，任何人都能讀寫你的資料庫；有了規則，
> 即使拿到這組設定，也只能存取自己帳號底下的資料。

## 3. 設定安全規則（**必做**）

Firestore Database → **規則** → 全部取代成下面內容 → 發布：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 每位使用者只能讀寫自己 uid 底下的資料，其餘一律拒絕。
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

若只想讓自己這個帳號能用，可以再收緊成指定 uid：

```
allow read, write: if request.auth != null
  && request.auth.uid == userId
  && request.auth.token.email == "你的帳號@gmail.com";
```

## 4. 驗收

1. 開 https://prayer168.github.io/nature-classroom-hub/settings.html
2. 「登入與雲端資料庫」→「使用 Google 登入」→ 選擇帳號
3. 狀態變成「已登入」，下方顯示帳號與最後同步時間
4. 隨便改一筆資料（例如改一個成績），等約 3 秒
5. 到 Firebase 主控台 → Firestore → 應該看到 `users/{你的uid}/` 底下出現文件
6. 換一台裝置（或另一個瀏覽器）登入同一帳號，確認看到同一份資料

## 5. 資料如何存放

| 路徑 | 內容 |
| --- | --- |
| `users/{uid}/meta/state` | 版本、目前班級、設定、工具歷史、最後更新時間與寫入裝置 |
| `users/{uid}/data/lessons` | 各班課程單元 |
| `users/{uid}/data/students` | 學生名冊（含回收筒與停用狀態） |
| `users/{uid}/data/assessments` | 評量定義 |
| `users/{uid}/data/scores` | 成績與缺考標記 |
| `users/{uid}/data/rewards` | 點數流水帳與獎品目錄 |
| `users/{uid}/data/observations` | 觀察紀錄 |
| `users/{uid}/data/resources` | 教學資源清單 |
| `users/{uid}/data/logs` | 出席稽核與轉班紀錄 |
| `users/{uid}/attendance/{YYYY-MM}` | 出席，依月份分片 |

每份文件的 `payload` 欄位是該區段的 JSON 字串。第一階段永遠整段讀寫，不在雲端做查詢，
用字串可以完全避開 Firestore 對 `undefined`、巢狀陣列與鍵名字元的限制。
之後若要做逐筆更新或雲端查詢，再改成結構化欄位。

出席依月份分片，是為了避免整學年的出席擠在同一份文件而撞到 Firestore 單筆 1 MB 上限。

## 6. 同步行為

- 本機資料變動後約 **2.5 秒**自動推送，只上傳真的有變動的區段。
- 另一台裝置寫入時，本機會收到通知並自動拉回最新資料。
- **首次登入若雲端與本機都有資料**，系統會停下來問你要保留哪一份，不會擅自覆蓋。建議先「下載 JSON 備份」再選。

## 7. 目前限制

- 衝突處理是「以雲端為準」的簡單策略：兩台裝置同時修改同一筆資料時，後寫入的會覆蓋先寫入的。
- 只支援單一教師帳號。多位教師各自班級需要多租戶資料模型，屬於後續階段。
- 沒有欄位層級的權限，登入後即可讀寫自己全部的資料。
- Google Sheets 同步仍然保留，但定位改為「人類可讀的匯出與備份」，不再是主要的資料通道。
