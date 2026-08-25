/**
 * 自然課堂中控站 Google Workspace 橋接器
 *
 * 使用方式：
 * 1. 在 https://script.google.com 建立獨立專案。
 * 2. 貼上本檔內容，先手動執行 setupNatureHub() 並完成授權。
 * 3. 部署為 Web App，再把 /exec 網址貼到前端「串接與設定」。
 * 4. 在前端「連線診斷」依序執行唯讀診斷與寫入自我測試，確認六項能力都通過。
 *
 * 建議學校帳號部署選項：以「我」（指令碼擁有者）身分執行，
 * 存取權限設為學校網域內的使用者。實際選項受 Workspace 管理員政策影響。
 *
 * 重要：每次修改本檔後，必須在「部署」→「管理部署作業」→ 編輯 → 版本選「新版本」
 * 重新部署，前端才會執行新版程式。前端會比對 SCRIPT_VERSION 並在版本落後時提醒。
 */

const APP_NAME = '自然課堂中控站';
const SCRIPT_VERSION = '2.5.0';
const SCHEMA_VERSION = 2;

const PROP_SHEET_ID = 'NATURE_HUB_SHEET_ID';
const PROP_FOLDER_ID = 'NATURE_HUB_FOLDER_ID';
const PROP_LATEST_BACKUP_ID = 'NATURE_HUB_LATEST_BACKUP_ID';

/**
 * 各分頁欄位定義。Students 刻意不含 name 欄位：
 * 系統只保存學生編號，真實姓名不得寫入 Sheets、Drive 備份或 Docs 報告。
 */
const SHEET_DEFINITIONS = {
  Classes: ['id', 'code', 'name', 'grade', 'subject', 'schoolYear'],
  Lessons: ['classId', 'topic', 'session', 'task', 'startedAt'],
  Students: ['id', 'classId', 'number', 'seat', 'tags', 'note', 'active', 'deletedAt', 'createdAt'],
  TransferLog: ['id', 'studentId', 'fromClassId', 'toClassId', 'fromNumber', 'toNumber', 'at'],
  Attendance: ['date', 'studentId', 'status'],
  AttendanceLog: ['id', 'date', 'studentId', 'from', 'to', 'at'],
  Rewards: ['id', 'studentId', 'category', 'value', 'note', 'createdAt'],
  RewardMenu: ['id', 'name', 'cost', 'type', 'note'],
  Assessments: ['id', 'name', 'type', 'maxScore', 'weight', 'date'],
  Scores: ['studentId', 'assessmentId', 'score', 'status'],
  Observations: ['id', 'studentId', 'category', 'level', 'note', 'lesson', 'createdAt'],
  Resources: ['id', 'name', 'category', 'grade', 'type', 'url', 'size', 'tags', 'createdAt'],
  Metadata: ['key', 'value']
};

const SELF_TEST_SHEET = '_SelfTest';

/** 自動備份設定：每日一份，最多保留 30 份，超過就把最舊的移到垃圾桶。 */
const AUTO_BACKUP_TRIGGER = 'dailyBackup';
const AUTO_BACKUP_HOUR = 22;
const BACKUP_RETENTION = 30;
const BACKUP_PREFIX = 'backup-';

/* ------------------------------------------------------------------ 初始化 */

function setupNatureHub() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheet;
  const existingSheetId = properties.getProperty(PROP_SHEET_ID);
  if (existingSheetId) {
    spreadsheet = SpreadsheetApp.openById(existingSheetId);
  } else {
    spreadsheet = SpreadsheetApp.create(`${APP_NAME}－資料庫`);
    properties.setProperty(PROP_SHEET_ID, spreadsheet.getId());
  }

  let folder;
  const existingFolderId = properties.getProperty(PROP_FOLDER_ID);
  if (existingFolderId) {
    folder = DriveApp.getFolderById(existingFolderId);
  } else {
    folder = DriveApp.createFolder(`${APP_NAME}－教學資料`);
    properties.setProperty(PROP_FOLDER_ID, folder.getId());
  }

  Object.keys(SHEET_DEFINITIONS).forEach(name => ensureSheet_(spreadsheet, name, SHEET_DEFINITIONS[name]));
  return { sheetUrl: spreadsheet.getUrl(), folderUrl: folder.getUrl(), scriptVersion: SCRIPT_VERSION };
}

/* --------------------------------------------------------------- 自動備份 */

/**
 * 手動執行一次即可安裝每日備份觸發器（重複執行不會裝出第二個）。
 * 觸發器由 Google 在伺服器端執行，不需要教師開著網頁。
 */
function installDailyBackup() {
  removeDailyBackup();
  ScriptApp.newTrigger(AUTO_BACKUP_TRIGGER).timeBased().atHour(AUTO_BACKUP_HOUR).everyDays(1).create();
  return { ok: true, message: `已安裝每日 ${AUTO_BACKUP_HOUR} 點左右的自動備份，最多保留 ${BACKUP_RETENTION} 份。` };
}

function removeDailyBackup() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === AUTO_BACKUP_TRIGGER)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  return { ok: true };
}

/**
 * 觸發器進入點。把 Sheets 目前的內容導回 JSON 存成備份，
 * 因此備份的是「已同步到雲端的資料」，不是老師瀏覽器裡尚未同步的資料。
 */
function dailyBackup() {
  const resources = ensureSetup_();
  const payload = readSheetsSnapshot_(resources.spreadsheet);
  if (!payload.students.length) return { ok: false, error: '雲端尚無學生資料，略過本次自動備份。' };
  const name = `${BACKUP_PREFIX}${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss')}-auto.json`;
  const file = resources.folder.createFile(Utilities.newBlob(JSON.stringify(payload, null, 2), 'application/json', name));
  PropertiesService.getScriptProperties().setProperty(PROP_LATEST_BACKUP_ID, file.getId());
  const removed = pruneBackups_(resources.folder);
  return { ok: true, name, removed };
}

/** 只保留最新的 BACKUP_RETENTION 份備份，其餘移到垃圾桶。 */
function pruneBackups_(folder) {
  const backups = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().indexOf(BACKUP_PREFIX) === 0) backups.push({ file, at: file.getDateCreated().getTime() });
  }
  backups.sort((a, b) => b.at - a.at);
  const stale = backups.slice(BACKUP_RETENTION);
  stale.forEach(item => item.file.setTrashed(true));
  return stale.length;
}

/** 從 Sheets 分頁還原成前端使用的資料結構。 */
function readSheetsSnapshot_(spreadsheet) {
  const read = name => {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const keys = SHEET_DEFINITIONS[name];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, keys.length).getValues().map(row => {
      const item = {};
      keys.forEach((key, index) => { item[key] = row[index]; });
      return item;
    });
  };

  const attendance = {};
  read('Attendance').forEach(row => {
    const date = String(row.date);
    if (!date) return;
    attendance[date] = attendance[date] || {};
    attendance[date][row.studentId] = row.status;
  });

  const scores = {};
  const scoreStatus = {};
  read('Scores').forEach(row => {
    if (!row.studentId) return;
    scores[row.studentId] = scores[row.studentId] || {};
    scores[row.studentId][row.assessmentId] = row.score === '' ? null : row.score;
    if (row.status) {
      scoreStatus[row.studentId] = scoreStatus[row.studentId] || {};
      scoreStatus[row.studentId][row.assessmentId] = row.status;
    }
  });

  const lessons = {};
  read('Lessons').forEach(row => {
    if (!row.classId) return;
    lessons[row.classId] = { topic: row.topic, session: row.session, task: row.task, startedAt: row.startedAt || null };
  });

  const metadata = {};
  read('Metadata').forEach(row => { metadata[row.key] = row.value; });

  return {
    version: SCHEMA_VERSION,
    classes: read('Classes'),
    lessons,
    activeClassId: (read('Classes')[0] || {}).id || '',
    students: read('Students').map(student => ({ ...student, tags: String(student.tags || '').split(',').map(tag => tag.trim()).filter(String) })),
    attendance,
    attendanceLog: read('AttendanceLog'),
    transferLog: read('TransferLog'),
    observations: read('Observations'),
    rewards: { ledger: read('Rewards'), menu: read('RewardMenu') },
    assessments: read('Assessments'),
    scores,
    scoreStatus,
    resources: read('Resources').map(item => ({ ...item, tags: String(item.tags || '').split(',').map(tag => tag.trim()).filter(String) })),
    updatedAt: metadata.updatedAt || new Date().toISOString(),
    backupSource: 'auto'
  };
}

/* ------------------------------------------------------------- HTTP 進入點 */

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'ping';
    if (action === 'ping') return json_(ping_());
    if (action === 'diagnose') return json_(diagnose_());
    if (action === 'backup') return json_({ ok: true, scriptVersion: SCRIPT_VERSION, payload: readSnapshot_() });
    return json_({ ok: false, error: `不支援的 action：${action}`, scriptVersion: SCRIPT_VERSION });
  } catch (error) {
    return json_(errorResult_(error));
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    locked = lock.tryLock(30000);
    if (!locked) throw new Error('另一項同步正在進行中，請稍候再試。');
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (request.action === 'sync') return json_(syncPayload_(request.payload));
    if (request.action === 'selfTest') return json_(selfTest_(request.options || {}));
    if (request.action === 'createClassReport') return json_(createClassReport_(request.payload));
    if (request.action === 'createStudentReport') return json_(createStudentReport_(request.payload, request.studentId));
    if (request.action === 'uploadFile') return json_(uploadFile_(request.payload));
    return json_({ ok: false, error: `不支援的 action：${request.action}`, scriptVersion: SCRIPT_VERSION });
  } catch (error) {
    return json_(errorResult_(error));
  } finally {
    if (locked) lock.releaseLock();
  }
}

/* --------------------------------------------------------- 連線診斷與自我測試 */

function ping_() {
  const resources = ensureSetup_();
  return {
    ok: true,
    app: APP_NAME,
    scriptVersion: SCRIPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    sheetUrl: resources.spreadsheet.getUrl(),
    folderUrl: resources.folder.getUrl(),
    timeZone: Session.getScriptTimeZone(),
    effectiveUser: safeEmail_(() => Session.getEffectiveUser().getEmail()),
    activeUser: safeEmail_(() => Session.getActiveUser().getEmail()),
    serverTime: new Date().toISOString()
  };
}

/**
 * 唯讀診斷：不寫入任何資料，逐項回報 Sheets／Drive／備份狀態。
 */
function diagnose_() {
  const checks = [];
  const resources = ensureSetup_();
  const spreadsheet = resources.spreadsheet;

  checks.push({
    key: 'spreadsheet',
    label: 'Google Sheets 資料庫',
    ok: true,
    detail: `${spreadsheet.getName()}（${spreadsheet.getNumSheets()} 個分頁）`,
    url: spreadsheet.getUrl()
  });

  Object.keys(SHEET_DEFINITIONS).forEach(name => {
    const expected = SHEET_DEFINITIONS[name];
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      checks.push({ key: `sheet:${name}`, label: `分頁 ${name}`, ok: false, detail: '分頁不存在，請重新執行 setupNatureHub()。' });
      return;
    }
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim()).filter(String);
    const matches = headers.length === expected.length && expected.every((key, index) => headers[index] === key);
    const dataRows = Math.max(sheet.getLastRow() - 1, 0);
    checks.push({
      key: `sheet:${name}`,
      label: `分頁 ${name}`,
      ok: matches,
      detail: matches
        ? `${dataRows} 筆資料`
        : `欄位不符。目前：${headers.join(', ') || '（空白）'}；預期：${expected.join(', ')}`
    });
  });

  const folder = resources.folder;
  let fileCount = 0;
  const files = folder.getFiles();
  while (files.hasNext() && fileCount < 500) { files.next(); fileCount += 1; }
  checks.push({
    key: 'folder',
    label: 'Google Drive 資料夾',
    ok: true,
    detail: `${folder.getName()}（${fileCount}${fileCount >= 500 ? '+' : ''} 個檔案）`,
    url: folder.getUrl()
  });

  const triggers = ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === AUTO_BACKUP_TRIGGER);
  checks.push({
    key: 'autoBackup',
    label: '每日自動備份觸發器',
    ok: triggers.length > 0,
    detail: triggers.length
      ? `已安裝（每日約 ${AUTO_BACKUP_HOUR} 點，保留最近 ${BACKUP_RETENTION} 份）`
      : '尚未安裝。請在 Apps Script 手動執行一次 installDailyBackup()。'
  });

  const backupId = PropertiesService.getScriptProperties().getProperty(PROP_LATEST_BACKUP_ID);
  if (!backupId) {
    checks.push({ key: 'backup', label: '最新 Drive 備份', ok: false, detail: '尚無備份，請先執行一次「立即同步」。' });
  } else {
    try {
      const file = DriveApp.getFileById(backupId);
      checks.push({
        key: 'backup',
        label: '最新 Drive 備份',
        ok: true,
        detail: `${file.getName()}（${Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')}，${Math.round(file.getSize() / 1024)} KB）`,
        url: file.getUrl()
      });
    } catch (error) {
      checks.push({ key: 'backup', label: '最新 Drive 備份', ok: false, detail: `備份檔無法讀取：${error.message}` });
    }
  }

  return {
    ok: checks.every(check => check.ok),
    scriptVersion: SCRIPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    timeZone: Session.getScriptTimeZone(),
    effectiveUser: safeEmail_(() => Session.getEffectiveUser().getEmail()),
    serverTime: new Date().toISOString(),
    checks
  };
}

/**
 * 寫入自我測試：實際建立暫存分頁、Drive 檔案與 Google 文件，驗證後預設立即刪除，
 * 不會動到任何班級資料。options.keepArtifacts = true 時保留測試產物供人工檢視。
 */
function selfTest_(options) {
  const keep = options.keepArtifacts === true;
  const resources = ensureSetup_();
  const steps = [];
  const artifacts = [];

  steps.push(runStep_('sheets-write', 'Sheets 寫入與讀回', () => {
    const spreadsheet = resources.spreadsheet;
    const stamp = new Date().toISOString();
    let sheet = spreadsheet.getSheetByName(SELF_TEST_SHEET);
    if (!sheet) sheet = spreadsheet.insertSheet(SELF_TEST_SHEET);
    sheet.clearContents();
    sheet.getRange(1, 1, 1, 2).setValues([['selfTestAt', stamp]]);
    SpreadsheetApp.flush();
    const readBack = sheet.getRange(1, 2).getValue();
    const value = readBack instanceof Date ? readBack.toISOString() : String(readBack);
    if (value !== stamp) throw new Error(`寫入值與讀回值不一致（寫入 ${stamp}，讀回 ${value}）。`);
    if (!keep) spreadsheet.deleteSheet(sheet);
    return { detail: keep ? `已寫入暫存分頁 ${SELF_TEST_SHEET}（保留）` : '寫入與讀回一致，暫存分頁已移除。' };
  }));

  steps.push(runStep_('drive-upload', 'Drive 檔案建立與讀回', () => {
    const stamp = new Date().toISOString();
    const blob = Utilities.newBlob(`nature-classroom-hub self test ${stamp}`, 'text/plain', `selftest-${stamp.replace(/[:.]/g, '-')}.txt`);
    const file = resources.folder.createFile(blob);
    const content = file.getBlob().getDataAsString('UTF-8');
    if (content.indexOf(stamp) === -1) throw new Error('Drive 檔案內容讀回不一致。');
    if (keep) artifacts.push({ label: '測試檔案', url: file.getUrl() });
    else file.setTrashed(true);
    return { detail: keep ? '測試檔案已建立並保留於資料夾。' : '建立、讀回成功，測試檔案已移到垃圾桶。', url: keep ? file.getUrl() : '' };
  }));

  steps.push(runStep_('docs-create', 'Google Docs 建立與搬移', () => {
    const doc = DocumentApp.create(`${APP_NAME}－連線測試－${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss')}`);
    doc.getBody().appendParagraph('這是自然課堂中控站的連線測試文件，可安全刪除。');
    doc.saveAndClose();
    const file = DriveApp.getFileById(doc.getId());
    file.moveTo(resources.folder);
    if (keep) artifacts.push({ label: '測試文件', url: doc.getUrl() });
    else file.setTrashed(true);
    return { detail: keep ? '測試文件已建立並保留於資料夾。' : '建立與搬移成功，測試文件已移到垃圾桶。', url: keep ? doc.getUrl() : '' };
  }));

  return {
    ok: steps.every(step => step.ok),
    scriptVersion: SCRIPT_VERSION,
    keptArtifacts: keep,
    artifacts,
    serverTime: new Date().toISOString(),
    steps
  };
}

function runStep_(key, label, action) {
  const started = new Date().getTime();
  try {
    const result = action() || {};
    return { key, label, ok: true, ms: new Date().getTime() - started, detail: result.detail || '通過', url: result.url || '' };
  } catch (error) {
    return { key, label, ok: false, ms: new Date().getTime() - started, detail: error.message };
  }
}

/* ------------------------------------------------------------------- 同步 */

function syncPayload_(payload) {
  validatePayload_(payload);
  const safePayload = anonymize_(payload);
  const resources = ensureSetup_();
  const spreadsheet = resources.spreadsheet;
  Object.keys(SHEET_DEFINITIONS).forEach(name => ensureSheet_(spreadsheet, name, SHEET_DEFINITIONS[name]));

  writeObjects_(spreadsheet, 'Classes', safePayload.classes || []);
  writeObjects_(spreadsheet, 'Lessons', (safePayload.classes || []).map(item => {
    const lesson = lessonFor_(safePayload, item.id);
    return { classId: item.id, topic: lesson.topic, session: lesson.session, task: lesson.task, startedAt: lesson.startedAt };
  }));
  writeObjects_(spreadsheet, 'Students', safePayload.students || []);

  const attendanceRows = [];
  Object.keys(safePayload.attendance || {}).forEach(date => {
    Object.keys(safePayload.attendance[date] || {}).forEach(studentId => {
      attendanceRows.push({ date, studentId, status: safePayload.attendance[date][studentId] });
    });
  });
  writeObjects_(spreadsheet, 'Attendance', attendanceRows);
  writeObjects_(spreadsheet, 'AttendanceLog', safePayload.attendanceLog || []);
  writeObjects_(spreadsheet, 'TransferLog', safePayload.transferLog || []);

  writeObjects_(spreadsheet, 'Rewards', (safePayload.rewards && safePayload.rewards.ledger) || []);
  writeObjects_(spreadsheet, 'RewardMenu', (safePayload.rewards && safePayload.rewards.menu) || []);
  writeObjects_(spreadsheet, 'Assessments', safePayload.assessments || []);

  const scoreRows = [];
  Object.keys(safePayload.scores || {}).forEach(studentId => {
    Object.keys(safePayload.scores[studentId] || {}).forEach(assessmentId => {
      scoreRows.push({ studentId, assessmentId, score: safePayload.scores[studentId][assessmentId], status: (safePayload.scoreStatus && safePayload.scoreStatus[studentId] && safePayload.scoreStatus[studentId][assessmentId]) || '' });
    });
  });
  writeObjects_(spreadsheet, 'Scores', scoreRows);

  writeObjects_(spreadsheet, 'Observations', safePayload.observations || []);
  writeObjects_(spreadsheet, 'Resources', safePayload.resources || []);
  writeObjects_(spreadsheet, 'Metadata', [
    { key: 'updatedAt', value: safePayload.updatedAt || new Date().toISOString() },
    { key: 'syncedAt', value: new Date().toISOString() },
    { key: 'schemaVersion', value: safePayload.version },
    { key: 'scriptVersion', value: SCRIPT_VERSION },
    { key: 'classCount', value: (safePayload.classes || []).length },
    { key: 'studentCount', value: (safePayload.students || []).length }
  ]);

  const backupName = `backup-${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss')}.json`;
  const backupBlob = Utilities.newBlob(JSON.stringify(safePayload, null, 2), 'application/json', backupName);
  const backupFile = resources.folder.createFile(backupBlob);
  PropertiesService.getScriptProperties().setProperty(PROP_LATEST_BACKUP_ID, backupFile.getId());
  const prunedBackups = pruneBackups_(resources.folder);

  return {
    ok: true,
    scriptVersion: SCRIPT_VERSION,
    prunedBackups,
    sheetUrl: spreadsheet.getUrl(),
    folderUrl: resources.folder.getUrl(),
    backupName,
    backupUrl: backupFile.getUrl(),
    counts: {
      classes: (safePayload.classes || []).length,
      students: (safePayload.students || []).length,
      attendance: attendanceRows.length,
      scores: scoreRows.length,
      rewards: ((safePayload.rewards && safePayload.rewards.ledger) || []).length
    },
    syncedAt: new Date().toISOString()
  };
}

/* ------------------------------------------------------------- Docs 報告 */

function createClassReport_(payload) {
  validatePayload_(payload);
  const safePayload = anonymize_(payload);
  const resources = ensureSetup_();
  const currentClass = (safePayload.classes || []).find(item => item.id === safePayload.activeClassId) || (safePayload.classes || [])[0];
  const className = (currentClass && currentClass.name) || '班級';
  const students = (safePayload.students || []).filter(student => student.classId === safePayload.activeClassId);
  const studentIds = {};
  students.forEach(student => { studentIds[student.id] = true; });
  const doc = DocumentApp.create(`${className}自然科學習報告－${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')}`);
  const body = doc.getBody();
  body.appendParagraph('自然科學習報告').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(`${className}｜${lessonFor_(safePayload, safePayload.activeClassId).topic || '未設定單元'}`);
  body.appendParagraph(`產生時間：${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')}`);

  body.appendParagraph('班級摘要').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendListItem(`學生人數：${students.length} 人`);
  body.appendListItem(`評量項目：${(safePayload.assessments || []).length} 項`);
  body.appendListItem(`正向回饋紀錄：${((safePayload.rewards && safePayload.rewards.ledger) || []).filter(item => studentIds[item.studentId] && Number(item.value) > 0).length} 筆`);

  body.appendParagraph('學生學習概況').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const tableData = [['座號', '學生編號', '加權平均', '目前點數']];
  students.forEach(student => {
    tableData.push([String(student.seat), student.number, calculateAverage_(student.id, safePayload), String(calculatePoints_(student.id, safePayload))]);
  });
  body.appendTable(tableData);
  body.appendParagraph('說明：獎勵點數與學業成績分開呈現，不直接納入學業平均。本報告僅使用學生編號。').setItalic(true);

  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(resources.folder);
  return { ok: true, scriptVersion: SCRIPT_VERSION, url: doc.getUrl(), id: doc.getId() };
}

function createStudentReport_(payload, studentId) {
  validatePayload_(payload);
  const safePayload = anonymize_(payload);
  const student = safePayload.students.find(item => item.id === studentId);
  if (!student) throw new Error('找不到指定學生。');
  const resources = ensureSetup_();
  const currentClass = (safePayload.classes || []).find(item => item.id === student.classId);
  const className = (currentClass && currentClass.name) || '班級';
  const doc = DocumentApp.create(`學生${student.number}－自然科學習報告－${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')}`);
  const body = doc.getBody();
  body.appendParagraph('自然科個別學習報告').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(`${className}｜${student.seat} 號｜學生編號 ${student.number}`);
  body.appendParagraph(`學習單元：${lessonFor_(safePayload, student.classId).topic || '未設定單元'}`);
  body.appendParagraph(`產生時間：${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')}`);

  body.appendParagraph('學習摘要').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendListItem(`目前加權平均：${calculateAverage_(student.id, safePayload)}`);
  body.appendListItem(`目前獎勵點數：${calculatePoints_(student.id, safePayload)}`);

  body.appendParagraph('評量表現').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const scoreMap = (safePayload.scores && safePayload.scores[student.id]) || {};
  const scoreRows = [['評量', '類型', '得分', '滿分', '權重']];
  (safePayload.assessments || []).forEach(item => {
    const value = scoreMap[item.id];
    scoreRows.push([item.name, item.type || '', value === null || value === undefined || value === '' ? '待補' : String(value), String(item.maxScore), `${item.weight}%`]);
  });
  body.appendTable(scoreRows);

  body.appendParagraph('正向回饋與觀察').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const observations = (safePayload.observations || []).filter(item => item.studentId === student.id).slice(0, 20);
  if (!observations.length) body.appendParagraph('目前尚無觀察紀錄。');
  observations.forEach(item => body.appendListItem(`${item.category}${item.note ? `：${item.note}` : ''}`));
  body.appendParagraph('說明：獎勵點數與學業成績分開呈現，不直接納入學業平均。本報告僅使用學生編號。').setItalic(true);

  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(resources.folder);
  return { ok: true, scriptVersion: SCRIPT_VERSION, url: doc.getUrl(), id: doc.getId(), studentId: student.id };
}

/* --------------------------------------------------------------- 檔案上傳 */

function uploadFile_(payload) {
  if (!payload || !payload.name || !payload.base64) throw new Error('缺少檔名或檔案內容。');
  const resources = ensureSetup_();
  const bytes = Utilities.base64Decode(payload.base64);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('單一檔案請勿超過 8 MB。');
  const blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', payload.name);
  const file = resources.folder.createFile(blob);
  return { ok: true, scriptVersion: SCRIPT_VERSION, id: file.getId(), url: file.getUrl(), name: file.getName() };
}

/* ----------------------------------------------------------------- 工具函式 */

function ensureSetup_() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty(PROP_SHEET_ID) || !properties.getProperty(PROP_FOLDER_ID)) setupNatureHub();
  return {
    spreadsheet: SpreadsheetApp.openById(properties.getProperty(PROP_SHEET_ID)),
    folder: DriveApp.getFolderById(properties.getProperty(PROP_FOLDER_ID))
  };
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#dceee7');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function writeObjects_(spreadsheet, name, objects) {
  const keys = SHEET_DEFINITIONS[name];
  const sheet = ensureSheet_(spreadsheet, name, keys);
  sheet.clear();
  const rows = [keys].concat((objects || []).map(object => keys.map(key => {
    const value = object[key];
    if (Array.isArray(value)) return value.join(', ');
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  })));
  sheet.getRange(1, 1, rows.length, keys.length).setValues(rows);
  sheet.getRange(1, 1, 1, keys.length).setFontWeight('bold').setBackground('#dceee7');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, keys.length);
  return sheet;
}

/**
 * 取得指定班級的課程單元。1.3.0 起課程依班級各自獨立，舊資料則回退到單一 lesson。
 */
function lessonFor_(payload, classId) {
  const lessons = payload.lessons || {};
  return lessons[classId] || payload.lesson || { topic: '', session: '', task: '', startedAt: '' };
}

/**
 * 移除任何真實姓名欄位，確保寫入 Sheets、Drive 備份與 Docs 的資料只有學生編號。
 */
function anonymize_(payload) {
  const clone = JSON.parse(JSON.stringify(payload));
  clone.students = (clone.students || []).map(student => {
    const copy = {};
    Object.keys(student).forEach(key => {
      if (key === 'name' || key === 'fullName' || key === 'realName') return;
      copy[key] = student[key];
    });
    return copy;
  });
  return clone;
}

function validatePayload_(payload) {
  if (!payload) throw new Error('缺少資料內容。');
  if ([1, 2].indexOf(payload.version) === -1) throw new Error(`資料版本不支援（收到 ${payload.version}，支援 1 或 2）。`);
  if (!Array.isArray(payload.students)) throw new Error('學生資料格式不正確。');
}

function calculatePoints_(studentId, payload) {
  return ((payload.rewards && payload.rewards.ledger) || [])
    .filter(item => item.studentId === studentId)
    .reduce((sum, item) => sum + Number(item.value || 0), 0);
}

function calculateAverage_(studentId, payload) {
  const scoreMap = (payload.scores && payload.scores[studentId]) || {};
  let weighted = 0;
  let totalWeight = 0;
  (payload.assessments || []).forEach(item => {
    const value = scoreMap[item.id];
    if (value === null || value === undefined || value === '') return;
    weighted += Number(value) / Number(item.maxScore) * Number(item.weight);
    totalWeight += Number(item.weight);
  });
  return totalWeight ? (weighted / totalWeight * 100).toFixed(1) : '—';
}

function readSnapshot_() {
  ensureSetup_();
  const fileId = PropertiesService.getScriptProperties().getProperty(PROP_LATEST_BACKUP_ID);
  if (!fileId) throw new Error('Google Drive 尚無備份，請先執行一次「立即同步」。');
  const text = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  const payload = JSON.parse(text);
  validatePayload_(payload);
  return payload;
}

function safeEmail_(reader) {
  try {
    return reader() || '';
  } catch (error) {
    return '';
  }
}

function errorResult_(error) {
  return { ok: false, scriptVersion: SCRIPT_VERSION, error: error.message, stack: error.stack };
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
