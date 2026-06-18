const statusEl = document.getElementById("status");
const refreshButton = document.getElementById("refresh");
const rescanButton = document.getElementById("rescan");
const enabledInput = document.getElementById("enabled");
const siteEl = document.getElementById("site");
const scannedEl = document.getElementById("scanned");
const blockedEl = document.getElementById("blocked");
const markedEl = document.getElementById("marked");
const candidatesEl = document.getElementById("candidates");
const diagnosticEl = document.getElementById("diagnostic");

const CONTENT_STATUS_TIMEOUT_MS = 10000;
const CONTENT_STATUS_POLL_MS = 250;
const TRANSIENT_CONTENT_STATUSES = new Set(["starting", "injected", "scheduled", "predicting"]);
const POPUP_SUPPORTED_SITES = globalThis.ToxicShieldSupportedSites ?? {};
const POPUP_IS_SUPPORTED_URL = POPUP_SUPPORTED_SITES.isSupportedUrl || (() => false);

let activeTab = null;

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function hostnameForTab(tab) {
  try {
    return new URL(tab?.url || "").hostname;
  } catch {
    return "";
  }
}

function supportedPage(tab) {
  return POPUP_IS_SUPPORTED_URL(tab?.url || "");
}

async function ensureContentScript(tab) {
  if (!tab?.id || !supportedPage(tab)) return { ok: false, skipped: "unsupported_page" };
  return sendRuntimeMessage({
    type: "toxicShield:ensureContentScript",
    tabId: tab.id,
    hostname: hostnameForTab(tab),
    url: tab.url || "",
  });
}

function diagnosticText(payload, contentStatus, activeTabInfo, injectionError) {
  if (!supportedPage(activeTabInfo)) return "Unsupported page: this extension only scans supported social-media sites.";
  if (payload.site_enabled === false) return "Disabled on this site.";
  const model = payload.model || {};
  if (model.status === "error") return `Model error: ${model.error || "unknown error"}`;
  const stats = payload.stats || {};
  const status = contentStatus?.status || stats.lastScanStatus || "not_injected";
  const candidateCount = Number(contentStatus?.candidate_count ?? stats.lastCandidateCount ?? 0);

  if (status === "not_injected") {
    if (injectionError) return `Content script injection failed: ${injectionError}`;
    return "Content script has not reported from this tab yet. Reload the page after reloading the extension.";
  }
  if (status === "starting") return "Scanner is starting on this page...";
  if (status === "injected") return "Scanner injected. Waiting for the first scan to start...";
  if (status === "scheduled") return "Scanner scheduled. Waiting for visible comment candidates...";
  if (status === "adapter_missing") return "Scanner adapter failed to load on this page.";
  if (status === "no_candidates") return "No visible comment candidates found yet. Scroll to the comment area and rescan.";
  if (status === "prediction_error") return `Prediction error: ${contentStatus?.error || stats.lastScanError || "unknown error"}`;
  if (status === "predicting") return `Scanning ${candidateCount} candidate comment(s)...`;
  if (status === "idle") return "No new visible comments since the last scan.";
  if (status === "disabled") return "Disabled on this site.";
  if (status === "scanned") return `Last scan checked ${candidateCount} candidate comment(s).`;
  return `Page status: ${status}`;
}

function renderStatus(payload, contentStatus, activeTabInfo, injectionError) {
  enabledInput.checked = payload.site_enabled !== false;
  const model = payload.model || {};
  statusEl.textContent =
    model.status === "ready"
      ? `Offline model ready (${model.backend || "wasm"})`
      : model.status === "error"
        ? `Model error: ${model.error}`
        : "Model loads on first scan";
  scannedEl.textContent = String(payload.stats?.scanned || 0);
  blockedEl.textContent = String(payload.stats?.blocked || 0);
  markedEl.textContent = String(payload.stats?.marked || 0);
  candidatesEl.textContent = String(contentStatus?.candidate_count ?? payload.stats?.lastCandidateCount ?? 0);
  diagnosticEl.textContent = diagnosticText(payload, contentStatus, activeTabInfo, injectionError);
}

function isTransientContentStatus(contentStatus) {
  return TRANSIENT_CONTENT_STATUSES.has(contentStatus?.status);
}

async function readContentStatus(tab) {
  if (!tab?.id) return null;
  const response = await sendTabMessage(tab.id, { type: "toxicShield:getContentStatus" });
  return response?.content || null;
}

async function pollContentStatus(tab, payload, injectionError) {
  const deadline = Date.now() + CONTENT_STATUS_TIMEOUT_MS;
  let latestStatus = await readContentStatus(tab);
  renderStatus(payload, latestStatus, tab, injectionError);

  while (isTransientContentStatus(latestStatus) && Date.now() < deadline) {
    await delay(CONTENT_STATUS_POLL_MS);
    latestStatus = await readContentStatus(tab);
    renderStatus(payload, latestStatus, tab, injectionError);
  }

  return latestStatus;
}

async function refreshStatus() {
  statusEl.textContent = "Checking offline model...";
  diagnosticEl.textContent = "Checking page scanner...";
  try {
    activeTab = await getActiveTab();
    const hostname = hostnameForTab(activeTab);
    siteEl.textContent = hostname || "Unsupported page";
    let payload = await sendRuntimeMessage({
      type: "toxicShield:getStatus",
      tabId: activeTab?.id,
      hostname,
    });
    let injectionError = null;
    let contentStatus = await readContentStatus(activeTab);
    if (!contentStatus && activeTab?.id && supportedPage(activeTab)) {
      const injectionResult = await ensureContentScript(activeTab);
      injectionError = injectionResult?.injectionError || null;
      if (injectionResult?.markerPresent === false && !injectionError) {
        injectionError = "Content script marker was not found after injection.";
      }
      if (injectionResult?.ok) {
        contentStatus = await pollContentStatus(activeTab, payload, injectionError);
      }
    } else if (isTransientContentStatus(contentStatus)) {
      contentStatus = await pollContentStatus(activeTab, payload, injectionError);
    }
    payload = await sendRuntimeMessage({
      type: "toxicShield:getStatus",
      tabId: activeTab?.id,
      hostname,
    });
    renderStatus(payload, contentStatus, activeTab, injectionError);
  } catch (error) {
    statusEl.textContent = error.message;
    diagnosticEl.textContent = "Open a supported social page, then reload the extension and the page.";
  }
}

refreshButton.addEventListener("click", refreshStatus);
rescanButton.addEventListener("click", async () => {
  if (activeTab?.id) {
    await sendTabMessage(activeTab.id, { type: "toxicShield:rescan" });
    await refreshStatus();
  }
});

enabledInput.addEventListener("change", async () => {
  activeTab = activeTab || (await getActiveTab());
  const hostname = hostnameForTab(activeTab);
  await sendRuntimeMessage({
    type: "toxicShield:setSiteEnabled",
    tabId: activeTab?.id,
    hostname,
    enabled: enabledInput.checked,
  });
  refreshStatus();
});

refreshStatus();
