/**
 * 自然課堂中控站 Google Workspace 橋接器
 *
 * 使用方式：
 * 1. 在 https://script.google.com 建立獨立專案。
 * 2. 貼上本檔內容，先手動執行 setupNatureHub() 並完成授權。
 * 3. 部署為 Web App，再把 /exec 網址貼到前端「串接與設定」。
 *
 * 建議學校帳號部署選項：以存取網頁應用程式的使用者身分執行，
 * 並將存取範圍限制在學校網域。實際選項受 Workspace 管理員政策影響。
 */

const APP_NAME = '自然課堂中控站';
const PROP_SHEET_ID = 'NATURE_HUB_SHEET_ID';
const PROP_FOLDER_ID = 'NATURE_HUB_FOLDER_ID';
const PROP_LATEST_BACKUP_ID = 'NATURE_HUB_LATEST_BACKUP_ID';

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

  const definitions = {
    Students: ['id', 'classId', 'seat', 'name', 'tags', 'note', 'active', 'createdAt'],
    Attendance: ['date', 'studentId', 'status'],
    Rewards: ['id', 'studentId', 'category', 'value', 'note', 'createdAt'],
    Assessments: ['id', 'name', 'type', 'maxScore', 'weight', 'date'],
    Scores: ['studentId', 'assessmentId', 'score'],
    Observations: ['id', 'studentId', 'category', 'level', 'note', 'lesson', 'createdAt'],
    Metadata: ['key', 'value']
  };
  Object.keys(definitions).forEach(name => ensureSheet_(spreadsheet, name, definitions[name]));
  return { sheetUrl: spreadsheet.getUrl(), folderUrl: folder.getUrl() };
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'ping';
    if (action === 'ping') {
      const resources = ensureSetup_();
      return json_({ ok: true, app: APP_NAME, sheetUrl: resources.spreadsheet.getUrl(), serverTime: new Date().toISOString() });
    }
    if (action === 'backup') {
      return json_({ ok: true, payload: readSnapshot_() });
    }
    return json_({ ok: false, error: '不支援的 action。' });
  } catch (error) {
    return json_({ ok: false, error: error.message, stack: error.stack });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (request.action === 'sync') return json_(syncPayload_(request.payload));
    if (request.action === 'createClassReport') return json_(createClassReport_(request.payload));
    if (request.action === 'createStudentReport') return json_(createStudentReport_(request.payload, request.studentId));
    if (request.action === 'uploadFile') return json_(uploadFile_(request.payload));
    return json_({ ok: false, error: '不支援的 action。' });
  } catch (error) {
    return json_({ ok: false, error: error.message, stack: error.stack });
  } finally {
    lock.releaseLock();
  }
}

function syncPayload_(payload) {
  validatePayload_(payload);
  const resources = ensureSetup_();
  const spreadsheet = resources.spreadsheet;

  writeObjects_(spreadsheet.getSheetByName('Students'), payload.students, ['id', 'classId', 'seat', 'name', 'tags', 'note', 'active', 'createdAt']);

  const attendanceRows = [];
  Object.keys(payload.attendance || {}).forEach(date => {
    Object.keys(payload.attendance[date]).forEach(studentId => attendanceRows.push({ date, studentId, status: payload.attendance[date][studentId] }));
  });
  writeObjects_(spreadsheet.getSheetByName('Attendance'), attendanceRows, ['date', 'studentId', 'status']);
  writeObjects_(spreadsheet.getSheetByName('Rewards'), (payload.rewards && payload.rewards.ledger) || [], ['id', 'studentId', 'category', 'value', 'note', 'createdAt']);
  writeObjects_(spreadsheet.getSheetByName('Assessments'), payload.assessments || [], ['id', 'name', 'type', 'maxScore', 'weight', 'date']);

  const scoreRows = [];
  Object.keys(payload.scores || {}).forEach(studentId => {
    Object.keys(payload.scores[studentId] || {}).forEach(assessmentId => scoreRows.push({ studentId, assessmentId, score: payload.scores[studentId][assessmentId] }));
  });
  writeObjects_(spreadsheet.getSheetByName('Scores'), scoreRows, ['studentId', 'assessmentId', 'score']);
  writeObjects_(spreadsheet.getSheetByName('Observations'), payload.observations || [], ['id', 'studentId', 'category', 'level', 'note', 'lesson', 'createdAt']);
  writeObjects_(spreadsheet.getSheetByName('Metadata'), [
    { key: 'updatedAt', value: payload.updatedAt || new Date().toISOString() },
    { key: 'syncedAt', value: new Date().toISOString() },
    { key: 'schemaVersion', value: payload.version }
  ], ['key', 'value']);

  const backupName = `backup-${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss')}.json`;
  const backupBlob = Utilities.newBlob(JSON.stringify(payload, null, 2), 'application/json', backupName);
  const backupFile = resources.folder.createFile(backupBlob);
  PropertiesService.getScriptProperties().setProperty(PROP_LATEST_BACKUP_ID, backupFile.getId());

  return { ok: true, sheetUrl: spreadsheet.getUrl(), backupName, syncedAt: new Date().toISOString() };
}

function createClassReport_(payload) {
  validatePayload_(payload);
  const resources = ensureSetup_();
  const className = (payload.classes && payload.classes[0] && payload.classes[0].name) || '班級';
  const doc = DocumentApp.create(`${className}自然科學習報告－${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')}`);
  const body = doc.getBody();
  body.appendParagraph('自然科學習報告').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(`${className}｜${payload.lesson && payload.lesson.topic ? payload.lesson.topic : '未設定單元'}`);
  body.appendParagraph(`產生時間：${new Date().toLocaleString()}`);

  body.appendParagraph('班級摘要').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendListItem(`學生人數：${payload.students.length} 人`);
  body.appendListItem(`評量項目：${(payload.assessments || []).length} 項`);
  body.appendListItem(`正向回饋紀錄：${((payload.rewards && payload.rewards.ledger) || []).filter(item => Number(item.value) > 0).length} 筆`);

  body.appendParagraph('學生學習概況').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const tableData = [['座號', '姓名', '加權平均', '目前點數']];
  payload.students.forEach(student => {
    tableData.push([String(student.seat), student.name, calculateAverage_(student.id, payload), String(calculatePoints_(student.id, payload))]);
  });
  body.appendTable(tableData);
  body.appendParagraph('說明：獎勵點數與學業成績分開呈現，不直接納入學業平均。').setItalic(true);

  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId());
  file.moveTo(resources.folder);
  return { ok: true, url: doc.getUrl(), id: doc.getId() };
}

function createStudentReport_(payload, studentId) {
  validatePayload_(payload);
  const student = payload.students.find(item => item.id === studentId);
  if (!student) throw new Error('找不到指定學生。');
  const resources = ensureSetup_();
  const className = (payload.classes && payload.classes[0] && payload.classes[0].name) || '班級';
  const doc = DocumentApp.create(`${student.name}－自然科學習報告－${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')}`);
  const body = doc.getBody();
  body.appendParagraph('自然科個別學習報告').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(`${className}｜${student.seat} 號 ${student.name}`);
  body.appendParagraph(`學習單元：${payload.lesson && payload.lesson.topic ? payload.lesson.topic : '未設定單元'}`);
  body.appendParagraph(`產生時間：${new Date().toLocaleString()}`);

  body.appendParagraph('學習摘要').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendListItem(`目前加權平均：${calculateAverage_(student.id, payload)}`);
  body.appendListItem(`目前獎勵點數：${calculatePoints_(student.id, payload)}`);

  body.appendParagraph('評量表現').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const scoreMap = (payload.scores && payload.scores[student.id]) || {};
  const scoreRows = [['評量', '類型', '得分', '滿分', '權重']];
  (payload.assessments || []).forEach(item => scoreRows.push([item.name, item.type || '', scoreMap[item.id] === null || scoreMap[item.id] === undefined ? '待補' : String(scoreMap[item.id]), String(item.maxScore), `${item.weight}%`]));
  body.appendTable(scoreRows);

  body.appendParagraph('正向回饋與觀察').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  const observations = (payload.observations || []).filter(item => item.studentId === student.id).slice(0, 20);
  if (!observations.length) body.appendParagraph('目前尚無觀察紀錄。');
  observations.forEach(item => body.appendListItem(`${item.category}${item.note ? `：${item.note}` : ''}`));
  body.appendParagraph('說明：獎勵點數與學業成績分開呈現，不直接納入學業平均。').setItalic(true);

  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId());
  file.moveTo(resources.folder);
  return { ok: true, url: doc.getUrl(), id: doc.getId(), studentId: student.id };
}

function uploadFile_(payload) {
  if (!payload || !payload.name || !payload.base64) throw new Error('缺少檔名或檔案內容。');
  const resources = ensureSetup_();
  const bytes = Utilities.base64Decode(payload.base64);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('單一檔案請勿超過 8 MB。');
  const blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', payload.name);
  const file = resources.folder.createFile(blob);
  return { ok: true, id: file.getId(), url: file.getUrl(), name: file.getName() };
}

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

function writeObjects_(sheet, objects, keys) {
  sheet.clearContents();
  const rows = [keys].concat((objects || []).map(object => keys.map(key => {
    const value = object[key];
    return Array.isArray(value) ? value.join(', ') : (value === null || value === undefined ? '' : value);
  })));
  sheet.getRange(1, 1, rows.length, keys.length).setValues(rows);
  sheet.getRange(1, 1, 1, keys.length).setFontWeight('bold').setBackground('#dceee7');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, keys.length);
}

function validatePayload_(payload) {
  if (!payload || payload.version !== 1) throw new Error('資料版本不支援。');
  if (!Array.isArray(payload.students)) throw new Error('學生資料格式不正確。');
}

function calculatePoints_(studentId, payload) {
  return ((payload.rewards && payload.rewards.ledger) || []).filter(item => item.studentId === studentId).reduce((sum, item) => sum + Number(item.value || 0), 0);
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

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
