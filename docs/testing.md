# 自動化測試

共 54 項。以 [Playwright](https://playwright.dev/) 對建置後的正式產物做端對端測試，涵蓋前幾個版本原本靠人工點過一輪才能確認的流程。

## 執行

```bash
npm test           # 全部（桌機 + 手機）
npm run test:ui    # 開互動介面，可逐步重播
npx playwright test tests/grades.spec.js          # 只跑某個檔案
npx playwright test --project=mobile              # 只跑手機版面
npx playwright test -g "缺考"                      # 依測試名稱篩選
npx playwright show-trace test-results/<...>/trace.zip   # 失敗時看逐步錄影
```

首次執行前需要下載瀏覽器：

```bash
npx playwright install chromium
```

測試會自動執行 `npm run build` 並用 `vite preview` 起站，**測的是打包後的產物**而不是開發伺服器，因此連動態載入與 chunk 切分的行為都涵蓋在內。

## 涵蓋範圍

| 檔案 | 內容 |
| --- | --- |
| `tests/smoke.spec.js` | 十個頁面逐頁載入、標題、側欄導覽、班級切換器、無腳本錯誤 |
| `tests/migration.spec.js` | 1.x 姓名資料匿名化；五年級改制六年級的重新編號與八個 id 外鍵一起改名 |
| `tests/students.spec.js` | 停用與恢復、回收筒軟刪除與還原、徹底刪除的連帶清除、轉班改號與紀錄跟隨 |
| `tests/grades.spec.js` | 缺考推算與補考覆蓋、權重提醒、評量複製與刪除、匯入預覽八種狀態與復原 |
| `tests/attendance.spec.js` | 月曆與當月統計、補改留稽核、需關注名單、班級隔離 |
| `tests/resources.spec.js` | 依年級顯示、切換班級、調整單一資源的適用範圍 |
| `tests/rewards.spec.js` | 獎品庫存顯示與扣減、售罄擋下兌換、待交付清單與交付標記、舊資料相容 |
| `tests/student-detail.spec.js` | 個人趨勢面板的四個區塊、成績排序與班級平均對照、空資料情境 |
| `tests/mobile.spec.js` | 十頁在手機寬度下不整頁橫捲、固定頁首不超出畫面、寬表格只在容器內捲動 |

## 測試怎麼隔離環境

`tests/helpers.js` 做三件事：

1. **清空並植入 localStorage**。植入腳本在每次導覽都會重跑，而切換班級是整頁重載，因此用 `sessionStorage` 旗標確保清空與植入只在該分頁的第一次載入執行，否則測試中途的操作結果會被洗掉。清空與植入各有自己的旗標。
2. **攔截外部請求**。Google 字型與 Firebase 端點一律回空回應，測試不受網路狀況影響。用空回應而不是中斷，是因為中斷會在 console 留下 `ERR_FAILED`，跟「頁面不該有腳本錯誤」的斷言互相干擾。
3. **提供 `buildState()`** 產生六班各 30 人的基礎資料，再用 overrides 覆寫成特定情境。

## CI

`.github/workflows/test.yml` 會在推送到 `main` 與開 PR 時執行整套測試，失敗時上傳報告與追蹤檔（保留 7 天）。

## 尚未涵蓋

- Firebase 真實登入與跨裝置同步（需要實際帳號，目前靠人工驗收）
- Google Apps Script 串接（同上，改由前端的「連線診斷」負責）
- 課堂工具的麥克風與 QR Code 下載等需要裝置權限的功能
