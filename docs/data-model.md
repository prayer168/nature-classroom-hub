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

獎勵點數、學業成績、出席與課堂觀察各自保存，不以單一「學生總分」混合不同目的的資料。

