# Google Workspace 串接指南

系統採用 Google Apps Script Web App 作為前端與 Google Workspace 的橋接層。它能把班級資料同步到 Google Sheets、在 Drive 建立與還原 JSON 備份、上傳教學檔案，並用 Google Docs 產生班級或個別學生學習報告。部署後的本系統也可以直接嵌入 Google Sites。

## 1. 建立 Apps Script 橋接器

1. 使用預計保存教學資料的 Google 帳號開啟 [Google Apps Script](https://script.google.com/)。
2. 建立「新專案」，將 `integrations/apps-script/Code.gs` 的內容貼入編輯器。
3. 在上方函式選單選擇 `setupNatureHub`，按「執行」。
4. 完成 Google Sheets、Docs 與 Drive 權限授權。
5. 執行完成後，Google Drive 會出現一份「自然課堂中控站－資料庫」試算表與一個「自然課堂中控站－教學資料」資料夾。

## 2. 部署 Web App

1. Apps Script 右上角選「部署」→「新增部署作業」。
2. 類型選「網頁應用程式」。
3. 學校網域環境建議以「存取網頁應用程式的使用者」身分執行，並把存取範圍限制在學校網域；實際選項依管理員政策為準。
4. 完成部署後複製以 `/exec` 結尾的 Web App 網址。
5. 回到本系統「串接與設定」，貼上網址後按「儲存並測試」。

> 每次修改 `Code.gs` 後，需要在「管理部署作業」建立新版本，前端才會執行新版程式。

## 3. 同步與報告

- 「立即同步」會整批更新 Sheets 的 Students、Attendance、Rewards、Assessments、Scores、Observations 與 Metadata 分頁，並在 Drive 留下一份 JSON 備份。
- 「從 Google 還原」會讀取最近一次成功同步建立的 JSON 備份；還原前會再次確認，並覆蓋目前本機結構化資料。
- 統計報表可建立班級摘要或個別學生報告，內容把學業平均、獎勵點數與觀察紀錄分區呈現。
- 教學資料庫的本機檔案可逐一備份到 Drive；受 Apps Script 傳輸限制，單一檔案上限為 8 MB，大檔請直接使用 Google Drive 上傳。

## 4. 嵌入 Google Sites

先把前端部署到 HTTPS 靜態網站（例如 GitHub Pages），或直接把 Apps Script Web App 當入口。在 Google Sites 編輯畫面選「插入」→「嵌入」→「網址」，貼上部署網址。若畫面要求授權，需確認 Web App 的執行身分與網域存取設定。

## 資安注意事項

- 不要把 Google OAuth token、服務帳戶私鑰或 API 金鑰放進前端檔案。
- 學生姓名、出席、備註與成績屬敏感教育資料；優先限制在學校 Workspace 網域，並遵循校內個資保存規範。
- 共用電腦使用完畢後，請下載備份並清除瀏覽器站台資料。
- 若要提供多校、多教師與家長登入，下一階段應改用正式身分驗證及資料庫列級權限，不應把 Apps Script 公開成「任何人」可存取。
