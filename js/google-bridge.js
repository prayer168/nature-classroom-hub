import { store } from "./store.js";

export async function pingGoogle(url = store.get().settings.appsScriptUrl) {
  if (!url) throw new Error("請先輸入 Apps Script Web App 網址。");
  const separator = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${separator}action=ping&ts=${Date.now()}`, { redirect: "follow" });
  if (!response.ok) throw new Error(`連線失敗（HTTP ${response.status}）`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "Apps Script 沒有回傳成功狀態。");
  return result;
}

export async function syncToGoogle() {
  const state = store.get();
  const url = state.settings.appsScriptUrl;
  if (!url) throw new Error("尚未設定 Google Apps Script 網址。");
  const response = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "sync", payload: state })
  });
  if (!response.ok) throw new Error(`同步失敗（HTTP ${response.status}）`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "同步失敗。");
  store.update(draft => { draft.settings.lastSyncAt = new Date().toISOString(); });
  return result;
}

export async function fetchGoogleBackup() {
  const url = store.get().settings.appsScriptUrl;
  if (!url) throw new Error("尚未設定 Google Apps Script 網址。");
  const separator = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${separator}action=backup&ts=${Date.now()}`, { redirect: "follow" });
  if (!response.ok) throw new Error(`讀取備份失敗（HTTP ${response.status}）`);
  const result = await response.json();
  if (!result.ok || !result.payload) throw new Error(result.error || "Google Drive 尚無可還原的備份。");
  return result;
}

export async function uploadFileToGoogle(blob, name, mimeType = "application/octet-stream") {
  const state = store.get();
  const url = state.settings.appsScriptUrl;
  if (!url) throw new Error("尚未設定 Google Apps Script 網址。");
  if (blob.size > 8 * 1024 * 1024) throw new Error("單一檔案請勿超過 8 MB。");
  const base64 = await blobToBase64(blob);
  const response = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "uploadFile", payload: { name, mimeType: mimeType || blob.type, base64 } })
  });
  if (!response.ok) throw new Error(`檔案上傳失敗（HTTP ${response.status}）`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "檔案上傳失敗。");
  return result;
}

export async function createGoogleDocReport() {
  const state = store.get();
  const url = state.settings.appsScriptUrl;
  if (!url) throw new Error("尚未設定 Google Apps Script 網址。");
  const response = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "createClassReport", payload: state })
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "無法建立 Google Docs 報告。");
  return result;
}

export async function createStudentGoogleDocReport(studentId) {
  const state = store.get();
  const url = state.settings.appsScriptUrl;
  if (!url) throw new Error("尚未設定 Google Apps Script 網址。");
  if (!state.students.some(student => student.id === studentId)) throw new Error("找不到指定學生。");
  const response = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "createStudentReport", studentId, payload: state })
  });
  if (!response.ok) throw new Error(`建立報告失敗（HTTP ${response.status}）`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || "無法建立個別學生報告。");
  return result;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error || new Error("無法讀取檔案。"));
    reader.readAsDataURL(blob);
  });
}
