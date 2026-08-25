# 自然課堂中控站 Nature Classroom Hub

給台灣國中小自然科教師使用的輕量課堂工作台。把點名、正向回饋、成績、課堂小工具、教材與 Google Workspace 備份集中在同一個入口。

## 立即使用

正式網站：[https://prayer168.github.io/nature-classroom-hub/](https://prayer168.github.io/nature-classroom-hub/)

系統預設使用瀏覽器本機儲存，不會把教師輸入的學生資料送到 GitHub。若要啟用 Google Sheets、Docs 與 Drive，請由教師自行部署 Apps Script 橋接器。

## 已完成功能

- 今日課堂：到課／遲到／缺席、課堂任務、即時觀察與正向點數。
- 教室座位圖：依「自然教室一」實際配置呈現 5 張實驗桌與 30 個座位，可直接點名、個人／小組加點與查看學生摘要。
- 學生與班級：支援 402、403、501、502、503、508 六班切換；全站只使用匿名學生編號，可新增、編輯、線上刪除、搜尋、CSV 匯入與匯出。
- 排序與視覺化：可依成績或獎勵點數排序，顯示班級平均、中位數、平均點數與前 10 名橫條比較圖。
- 正向獎勵：六種集點行為說明、個人或多人快速加點、四個點數級距、科學玩具／3D 列印／盲盒獎品目錄與完整兌換流水帳。
- 成績與評量：自訂滿分與權重、直接輸入成績、加權平均、CSV 匯出。
- 自然課工具：倒數計時、碼表、公平點名、分組、骰子、實驗安全檢核、QR Code 與即時音量燈。
- 教學資料庫：IndexedDB 離線檔案、外部連結、搜尋、分類、下載、刪除與單檔 Drive 備份。
- 報表：出席、評量趨勢、回饋類型、教學行動建議，以及班級／個別學生 Google Docs。
- 備份：完整 JSON 本機備份／還原，以及 Google Drive 最新備份還原。
- Google Workspace：Apps Script 範本可同步 Sheets、備份／還原 Drive、上傳教材、產生 Docs 報告並嵌入 Sites。

## 本機啟動

```powershell
npm install
npm run dev
```

依終端機顯示的網址開啟即可。若只想快速預覽，也可使用任一靜態 HTTP 伺服器；因採 ES Modules，不建議直接用 `file://` 開啟。

## 建置

```powershell
npm run build
npm run preview
```

產物會輸出至 `dist/`。推送到 `main` 後，GitHub Actions 會自動部署到 GitHub Pages，也可再嵌入 Google Sites。

## Google 串接

請依 [Google Workspace 串接指南](docs/google-integration.md) 部署 `integrations/apps-script/Code.gs`。未完成 Google 授權前，系統會保持本機模式，不會聲稱資料已同步。

## 設計原則

- 獎勵點數不等於學業成績。
- 不輸入或顯示學生真實姓名；舊版資料會在載入時立即匿名化。
- 課堂觀察預設私密，投影模式隱藏個別資料。
- 不做負向公開排行榜；「需要支持」只記錄、不扣點。
- localStorage 保存結構化資料，IndexedDB 保存離線教材檔案。
- 不把 Google 權杖、私鑰或 API 金鑰放進前端。

## 文件

- [產品開發提示詞](docs/product-prompt.md)
- [同類平台研究](docs/market-research.md)
- [資料模型](docs/data-model.md)
- [測試報告](docs/test-report.md)
- [自然教室一原配置圖](assets/images/classroom-layout-reference.jpg)
- [中英文分享文案](share/facebook-post.html)

## 授權

MIT
