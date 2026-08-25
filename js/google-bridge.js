import { store } from "./store.js";

/** 前端預期的 Apps Script 版本。Code.gs 的 SCRIPT_VERSION 低於此值代表使用者尚未重新部署。 */
export const EXPECTED_SCRIPT_VERSION = "2.3.0";

const DEFAULT_TIMEOUT = 30_000;
const SYNC_TIMEOUT = 60_000;
const URL_PATTERN = /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[^/]+\/exec/;

export function isValidAppsScriptUrl(url) {
  return URL_PATTERN.test(String(url || "").trim());
}

export function compareScriptVersion(actual, expected = EXPECTED_SCRIPT_VERSION) {
  const parse = value => String(value || "0").split(".").map(part => Number(part) || 0);
  const [a, b] = [parse(actual), parse(expected)];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function requireUrl(url = store.get().settings.appsScriptUrl) {
  const value = String(url || "").trim();
  if (!value) throw new Error("尚未設定 Google Apps Script 網址，請先在上方貼上並儲存。");
  return value;
}

function withQuery(url, params) {
  const separator = url.includes("?") ? "&" : "?";
  const query = Object.entries({ ...params, ts: Date.now() })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${url}${separator}${query}`;
}

/**
 * 統一的 Apps Script 呼叫入口。
 * 負責逾時中斷、把 Google 登入頁／權限錯誤頁轉成看得懂的訊息，並統一回傳 JSON。
 */
async function callAppsScript(url, { method = "GET", body = null, timeoutMs = DEFAULT_TIMEOUT, label = "連線", allowFailure = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      // 使用 text/plain 可避免瀏覽器送出 preflight，Apps Script 不接受 OPTIONS。
      ...(body === null ? {} : { headers: { "Content-Type": "text/plain;charset=utf-8" }, body })
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${label}逾時（超過 ${Math.round(timeoutMs / 1000)} 秒）。資料量大時 Apps Script 會較慢，請稍後重試或減少同步範圍。`);
    }
    throw new Error(`${label}無法連線：${error.message}。常見原因是網路中斷，或 Web App 存取權限未開放給目前的 Google 帳號。`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${label}被拒絕（HTTP ${response.status}）。請在 Apps Script「管理部署作業」把存取權限改為學校網域或「知道連結的任何人」，並確認瀏覽器登入的是有權限的 Google 帳號。`);
    }
    if (response.status === 404) {
      throw new Error(`${label}失敗（HTTP 404）。這個 /exec 網址不存在，可能是部署被刪除或網址複製錯誤。`);
    }
    throw new Error(`${label}失敗（HTTP ${response.status}）。`);
  }

  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${label}沒有收到任何回應內容，請確認 Web App 已重新部署為新版本。`);
  if (trimmed.startsWith("<")) {
    if (/accounts\.google\.com|使用者登入|Sign in/i.test(trimmed)) {
      throw new Error(`${label}被導向 Google 登入頁。請先在同一個瀏覽器登入有權限的 Google 帳號，或把 Web App 存取權限放寬。`);
    }
    if (/授權|Authorization|permission/i.test(trimmed)) {
      throw new Error(`${label}遭遇授權錯誤。請回到 Apps Script 手動執行一次 setupNatureHub() 完成授權，再重新部署。`);
    }
    throw new Error(`${label}回傳的是網頁而非資料。多半代表 Web App 未正確部署，或網址不是以 /exec 結尾。`);
  }

  let result;
  try {
    result = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label}回應格式無法解析：${trimmed.slice(0, 120)}`);
  }
  // 診斷與自我測試在「有項目未通過」時會回傳 ok:false 但附上完整結果，
  // 那是正常的回報而不是連線失敗，必須原樣交給呼叫端呈現。
  if (allowFailure && result && (Array.isArray(result.checks) || Array.isArray(result.steps))) return result;
  if (!result || result.ok !== true) {
    if (result && result.error) throw new Error(result.error);
    throw new Error(`${label}失敗，Apps Script 未回傳成功狀態。原始回應：${trimmed.slice(0, 200)}`);
  }
  return result;
}

/* ------------------------------------------------------------ 連線與診斷 */

export async function pingGoogle(url = store.get().settings.appsScriptUrl) {
  return callAppsScript(withQuery(requireUrl(url), { action: "ping" }), { label: "連線測試" });
}

/** 唯讀診斷：檢查分頁欄位、Drive 資料夾與最新備份，不寫入任何資料。 */
export async function diagnoseGoogle(url = store.get().settings.appsScriptUrl) {
  return callAppsScript(withQuery(requireUrl(url), { action: "diagnose" }), { label: "連線診斷", timeoutMs: SYNC_TIMEOUT, allowFailure: true });
}

/** 寫入自我測試：建立暫存分頁、Drive 檔案與 Google 文件後刪除，不影響班級資料。 */
export async function selfTestGoogle({ keepArtifacts = false, url } = {}) {
  return callAppsScript(requireUrl(url), {
    method: "POST",
    body: JSON.stringify({ action: "selfTest", options: { keepArtifacts } }),
    timeoutMs: SYNC_TIMEOUT,
    label: "寫入測試",
    allowFailure: true
  });
}

/* ---------------------------------------------------------------- 同步 */

export async function syncToGoogle() {
  const state = store.get();
  const result = await callAppsScript(requireUrl(state.settings.appsScriptUrl), {
    method: "POST",
    body: JSON.stringify({ action: "sync", payload: state }),
    timeoutMs: SYNC_TIMEOUT,
    label: "資料同步"
  });
  store.update(draft => { draft.settings.lastSyncAt = new Date().toISOString(); });
  return result;
}

export async function fetchGoogleBackup() {
  return callAppsScript(withQuery(requireUrl(), { action: "backup" }), { label: "讀取備份", timeoutMs: SYNC_TIMEOUT });
}

export async function uploadFileToGoogle(blob, name, mimeType = "application/octet-stream") {
  const url = requireUrl();
  if (blob.size > 8 * 1024 * 1024) throw new Error("單一檔案請勿超過 8 MB，大檔請直接上傳 Google Drive。");
  const base64 = await blobToBase64(blob);
  return callAppsScript(url, {
    method: "POST",
    body: JSON.stringify({ action: "uploadFile", payload: { name, mimeType: mimeType || blob.type, base64 } }),
    timeoutMs: SYNC_TIMEOUT,
    label: "檔案上傳"
  });
}

/* ------------------------------------------------------------ Docs 報告 */

export async function createGoogleDocReport() {
  return callAppsScript(requireUrl(), {
    method: "POST",
    body: JSON.stringify({ action: "createClassReport", payload: store.get() }),
    timeoutMs: SYNC_TIMEOUT,
    label: "建立班級報告"
  });
}

export async function createStudentGoogleDocReport(studentId) {
  const state = store.get();
  if (!state.students.some(student => student.id === studentId)) throw new Error("找不到指定學生。");
  return callAppsScript(requireUrl(), {
    method: "POST",
    body: JSON.stringify({ action: "createStudentReport", studentId, payload: state }),
    timeoutMs: SYNC_TIMEOUT,
    label: "建立個別報告"
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error || new Error("無法讀取檔案。"));
    reader.readAsDataURL(blob);
  });
}
