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

