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

### 4-1 登入

1. 開 https://prayer168.github.io/nature-classroom-hub/settings.html
2. 「登入與雲端資料庫」→「使用 Google 登入」→ 選擇帳號
3. 狀態變成「已登入」，下方顯示帳號與最後同步時間
4. 隨便改一筆資料（例如改一個成績），等約 3 秒

### 4-2 到 Firestore 確認資料真的上去了

1. 開 [Firebase 主控台](https://console.firebase.google.com/)，選你的專案
2. 左側「專案捷徑」點 **Firestore**（或左側選單 → 建構 → Firestore Database）
3. 上方確認選的是 **「面板檢視畫面」**分頁，不是「查詢建立工具」
4. 最左欄點 **`users`**
5. 中間欄出現一份以你的 uid 命名的文件（一長串英數字），點它
6. 右欄是子集合清單，應該看到 **`sections`** 與 **`meta`**
   （若是從第一階段升級上來的，還會有 `data` 與 `attendance` 兩個舊集合，那是保留的備援）
7. 點 **`sections`**，文件清單應該包含：

   ```
   assessments   attendanceLog   attendance__2026-08   lessons
   meta          observations    resources             rewardsLedger
   rewardsMenu   scoreStatus     scores                students
   transferLog
   ```

   `attendance__YYYY-MM` 是出席的月份分片，有幾個月就有幾份。
   用兩個底線是因為 Firestore 文件名稱不接受冒號。

8. 點 **`students`**，右邊會顯示四個欄位：

   | 欄位 | 預期內容 |
   | --- | --- |
   | `payload` | JSON 字串，開頭類似 `{"students":[{"active":true,...` |
   | `rev` | 數字，至少 1，每次寫入加一 |
   | `deviceId` | `dev-` 開頭的字串 |
   | `updatedAt` | ISO 時間字串 |

   看到 `rev` 就代表逐區段並行控制已經生效。

9. 回到 uid 那層 → **`meta`** → **`index`**，欄位有 `updatedAt`、`deviceId` 與 `sections` 陣列。

**若 `sections` 沒出現**：多半是瀏覽器還在跑舊版程式。到設定頁按 Ctrl+Shift+R 強制重新載入，
確認狀態是「已登入」，改一筆資料等幾秒，再回 Firestore 重新整理。

### 4-3 跨裝置與並行測試

1. 換一台裝置（或同一台開無痕視窗）登入同一帳號，確認看到同一份資料
2. 兩邊各改**不同**學生的成績 → 等幾秒，兩邊都應該看得到兩筆變更
3. 兩邊改**同一位**學生的**同一項**成績 → 後同步的那台保留自己的版本，
   並在設定頁的「登入與雲端資料庫」區塊看到衝突提示，列出被覆蓋的項目

確認以上都正常後，第一階段留下的 `data` 與 `attendance` 兩個舊集合就可以刪除
（點該集合 → 右上角三個點 → 刪除集合）。

## 5. 資料如何存放

| 路徑 | 內容 |
| --- | --- |
| `users/{uid}/meta/index` | 最後寫入時間與裝置，供其他裝置偵測變動 |
| `users/{uid}/sections/meta` | 版本、目前班級、設定、工具歷史 |
| `users/{uid}/sections/students` | 學生名冊（含回收筒與停用狀態） |
| `users/{uid}/sections/lessons` | 各班課程單元 |
| `users/{uid}/sections/assessments` | 評量定義 |
| `users/{uid}/sections/scores`、`scoreStatus` | 成績與缺考標記 |
| `users/{uid}/sections/rewardsLedger`、`rewardsMenu` | 點數流水帳與獎品目錄（含庫存） |
| `users/{uid}/sections/observations` | 觀察紀錄 |
| `users/{uid}/sections/resources` | 教學資源清單 |
| `users/{uid}/sections/attendanceLog`、`transferLog` | 出席補改與轉班紀錄 |
| `users/{uid}/sections/attendance__YYYY-MM` | 出席，依月份分片 |

每份文件有三個欄位：`payload`（該區段的 JSON 字串）、`rev`（版本號）與 `deviceId`。
用字串存放是因為永遠整段讀寫、不在雲端查詢，可以完全避開 Firestore 對
`undefined`、巢狀陣列與鍵名字元的限制。出席依月份分片，避免整學年撞到單筆 1 MB 上限。

> 第一階段的資料放在 `data/*` 與 `attendance/*`。升級後首次登入會自動搬到新結構，
> 舊文件保留不刪當備援，確認新結構正常後可自行刪除。

## 6. 同步與衝突處理

- 本機資料變動後約 **2 秒**自動推送，只上傳真的有變動的區段。
- 每個區段各自一筆交易。寫入前比對 `rev`：一致就直接寫；不一致代表別台裝置先寫過，
  改用**三方合併**——比較「上次同步的內容」「本機」「雲端」三份，
  只有一邊改就採用那一邊，兩邊改到**同一筆**才算真衝突。
- 因此不同學生的成績、不同日期的出席、不同筆點數紀錄可以在兩台裝置同時修改而互不影響。
- 刪除也判斷得出來：本機刪掉的不會被雲端舊值復活，雲端新增的也不會被本機吃掉。
- 真衝突會**保留這台裝置的版本**，並在設定頁列出被覆蓋的項目；若另一台才是正確的，請到那台重新輸入。
- 另一台裝置寫入時，本機會收到通知並走合併（不是覆蓋）把變更拉回來。
- **首次登入若雲端與本機都有資料**，系統會停下來問你要保留哪一份。建議先「下載 JSON 備份」再選。

## 7. 目前限制

- 真衝突（兩台裝置改到同一筆）採「保留本機、回報覆蓋」，不做欄位層級的自動合併。
- 只支援單一教師帳號。多位教師各自班級需要多租戶資料模型，屬於後續階段。
- 沒有欄位層級的權限，登入後即可讀寫自己全部的資料。
- Google Sheets 同步仍然保留，但定位改為「人類可讀的匯出與備份」，不再是主要的資料通道。
