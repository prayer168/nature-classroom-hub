# 資料模型

| 集合 | 主要欄位 | 用途 |
|---|---|---|
| classes | id, name, grade, subject, schoolYear | 班級基本資料 |
| students | id, classId, seat, name, tags, note | 學生名冊與教師私密備註 |
| attendance | date → studentId → status | 每日出席；present／late／absent |
| observations | studentId, category, level, lesson, note, createdAt | 課堂觀察事件 |
| rewards.ledger | studentId, category, value, note, createdAt | 點數不可覆寫的流水帳 |
| rewards.menu | name, cost, note | 兌換選單 |
| assessments | name, type, maxScore, weight, date | 評量定義 |
| scores | studentId → assessmentId → score | 原始分數；null 表示待輸入 |
| resources | name, category, type, url／IndexedDB id | 教材中繼資料 |
| settings | appsScriptUrl, lastSyncAt, privacy flags | 串接與隱私設定 |

## 自然教室一座位配置

| 實驗桌 | 上排 | 下排 |
|---|---|---|
| 第一組（左前） | 7、22、2 | 17、27、12 |
| 第二組（右前） | 6、21、1 | 16、26、11 |
| 第三組（左中） | 9、24、4 | 19、29、14 |
| 第四組（右中） | 8、23、3 | 18、28、13 |
| 第五組（右後） | 10、25、5 | 20、30、15 |

場域包含教師角、白板與講桌、魚菜共生系統、自然教具區、新興科技工作坊、自然教具展示區、後門與走廊。

獎勵點數、學業成績、出席與課堂觀察各自保存，不以單一「學生總分」混合不同目的的資料。
