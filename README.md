# 自然課堂中控站 Nature Classroom Hub

給台灣國中小自然科教師使用的輕量課堂工作台。把點名、正向回饋、成績、課堂小工具、教材與 Google Workspace 備份集中在同一個入口。

## 已完成的 MVP

- 今日課堂：到課／遲到／缺席、課堂任務、即時觀察與正向點數。
- 教室座位圖：依「自然教室一」實際配置呈現 5 張實驗桌與 30 個座位，可直接點名、加點與查看學生摘要。
- 學生與班級：新增、編輯、刪除、搜尋、CSV 匯入與匯出。
- 正向獎勵：個人或多人加點、兌換選單、完整流水帳。
- 成績與評量：自訂滿分與權重、直接輸入成績、加權平均、CSV 匯出。
- 自然課工具：倒數計時、碼表、公平點名、分組、骰子、實驗安全檢核。
- 教學資料庫：IndexedDB 離線檔案、外部連結、搜尋、分類、下載與刪除。
- 報表：出席、評量趨勢、回饋類型與教學行動建議。
- 備份：完整 JSON 備份／還原。
- Google Workspace：Apps Script 範本可同步 Sheets、備份 Drive、產生 Docs 報告並嵌入 Sites。

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

產物會輸出至 `dist/`，可部署到 GitHub Pages 或其他 HTTPS 靜態空間，再嵌入 Google Sites。

## Google 串接

請依 [Google Workspace 串接指南](docs/google-integration.md) 部署 `integrations/apps-script/Code.gs`。未完成 Google 授權前，系統會保持本機模式，不會聲稱資料已同步。

## 設計原則

- 獎勵點數不等於學業成績。
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

## 授權

MIT
