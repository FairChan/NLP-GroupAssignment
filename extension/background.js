importScripts("supported_sites.js", "shared.js", "background_helpers.js");

const BG_SUPPORTED_SITES = globalThis.ToxicShieldSupportedSites ?? {};
const BG_SHARED = globalThis.ToxicShieldShared ?? {};
const BG_HELPERS = globalThis.ToxicShieldBackgroundHelpers ?? {};

const BG_MAKE_INITIAL_STATS = BG_HELPERS.makeInitialStats;
const BG_MAKE_INITIAL_PROGRESS = BG_HELPERS.makeInitialProgress;
const BG_UPDATE_PROGRESS = BG_HELPERS.updateProgress;
const BG_UPDATE_STATS_WITH_RESULTS = BG_HELPERS.updateStatsWithResults;
const BG_UPDATE_STATS_WITH_SCAN_REPORT = BG_HELPERS.updateStatsWithScanReport;

const DEFAULT_BATCH_SIZE = 8;
const TARGET_HOST_KEY = "toxicShieldSiteSettings";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const OFFSCREEN_MESSAGE_RETRIES = 8;
const OFFSCREEN_MESSAGE_RETRY_DELAY_MS = 125;
const CONTENT_SCRIPT_FILES = ["supported_sites.js", "site_adapters.js", "content.js"];
const CONTENT_CSS_FILES = ["styles.css"];
const BG_IS_SUPPORTED_URL = BG_SUPPORTED_SITES.isSupportedUrl || (() => false);

let offscreenCreatePromise = null;
let modelState = {
  status: "idle",
  backend: null,
  error: null,
  loadedAt: null,
};
let runtimeProgress = BG_MAKE_INITIAL_PROGRESS();
const tabStats = new Map();

function normalizeHostname(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

function isSupportedContentUrl(url) {
  return BG_IS_SUPPORTED_URL(url);
}

async function getSiteSettings() {
  const stored = await chrome.storage.local.get(TARGET_HOST_KEY);
  return stored[TARGET_HOST_KEY] || {};
}

async function isSiteEnabled(hostname) {
  const settings = await getSiteSettings();
  const key = normalizeHostname(hostname);
  return settings[key] !== false;
}

async function setSiteEnabled(hostname, enabled) {
  const settings = await getSiteSettings();
  settings[normalizeHostname(hostname)] = Boolean(enabled);
  await chrome.storage.local.set({ [TARGET_HOST_KEY]: settings });
}

function sendTabMessageSafely(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, () => {
    chrome.runtime.lastError;
  });
}

async function readContentScriptMarker(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) {
    return {
      markerPresent: false,
      injectedVersion: null,
      injectedAt: null,
      injectionError: "Chrome scripting API is unavailable for marker diagnostics.",
    };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = document.documentElement;
        const injectedVersion = root?.dataset?.toxicShieldInjected || null;
        return {
          markerPresent: Boolean(injectedVersion),
          injectedVersion,
          injectedAt: root?.dataset?.toxicShieldInjectedAt || null,
        };
      },
    });
    const marker = results?.[0]?.result || {};
    return {
      markerPresent: Boolean(marker.markerPresent),
      injectedVersion: marker.injectedVersion || null,
      injectedAt: marker.injectedAt || null,
      injectionError: marker.markerPresent ? null : "Content script marker was not found after injection.",
    };
  } catch (error) {
    return {
      markerPresent: false,
      injectedVersion: null,
      injectedAt: null,
      injectionError: error?.message || "Unable to read content script injection marker.",
    };
  }
}

async function ensureContentScriptInjected(tabId, url) {
  if (!tabId) {
    return { ok: false, injectionError: "No active tab is available for scanner injection." };
  }
  if (!isSupportedContentUrl(url)) {
    return { ok: false, skipped: "unsupported_page" };
  }
  if (!chrome.scripting?.executeScript) {
    return { ok: false, injectionError: "Chrome scripting API is unavailable. Reload extension version 0.2.4 or newer." };
  }

  try {
    if (chrome.scripting.insertCSS) {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: CONTENT_CSS_FILES,
      });
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES,
    });
    const marker = await readContentScriptMarker(tabId);
    return {
      ok: true,
      injected: true,
      ...marker,
    };
  } catch (error) {
    return {
      ok: false,
      injectionError:
        error?.message ||
        "Chrome blocked scanner injection. Check extension site access for this social-media domain.",
    };
  }
}

async function injectSupportedTabIfNeeded(tabId, url) {
  if (!tabId || !isSupportedContentUrl(url)) return;
  const hostname = new URL(url).hostname;
  if (!(await isSiteEnabled(hostname))) return;
  await ensureContentScriptInjected(tabId, url);
}

function statsForTab(tabId) {
  if (!tabStats.has(tabId)) tabStats.set(tabId, BG_MAKE_INITIAL_STATS());
  return tabStats.get(tabId);
}

function updateRuntimeProgress(patch) {
  runtimeProgress = BG_UPDATE_PROGRESS(runtimeProgress, patch);
  return runtimeProgress;
}

function getStatusPayload(tabId, hostname) {
  const stats = tabId ? statsForTab(tabId) : BG_MAKE_INITIAL_STATS();
  return {
    model: modelState,
    stats,
    runtimeProgress,
    progress: runtimeProgress,
    hostname,
    lastScanStatus: stats.lastScanStatus,
    lastScanError: stats.lastScanError,
    lastCandidateCount: stats.lastCandidateCount,
    lastAdapterId: stats.lastAdapterId,
  };
}

function offscreenDocumentUrl() {
  return chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
}

function getOffscreenCreateReason() {
  return chrome.offscreen?.Reason?.WORKERS || chrome.offscreen?.Reason?.DOM_PARSER || "DOM_PARSER";
}

async function hasOffscreenDocument() {
  const documentUrl = offscreenDocumentUrl();
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl],
    });
    return contexts.length > 0;
  }
  if (self.clients?.matchAll) {
    const clients = await self.clients.matchAll();
    return clients.some((client) => client.url === documentUrl);
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    modelState = {
      status: "error",
      backend: null,
      error: "Chrome offscreen API is unavailable. Reload the extension in Chrome or Edge.",
      loadedAt: null,
    };
    throw new Error(modelState.error);
  }
  if (await hasOffscreenDocument()) return;
  if (!offscreenCreatePromise) {
    offscreenCreatePromise = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [getOffscreenCreateReason()],
      justification: "Run local ONNX toxic-comment inference in an extension document context.",
    }).finally(() => {
      offscreenCreatePromise = null;
    });
  }
  await offscreenCreatePromise;
}

function sendOffscreenMessage(message) {
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendOffscreenMessageWithRetry(message) {
  let lastError = null;
  for (let attempt = 0; attempt < OFFSCREEN_MESSAGE_RETRIES; attempt += 1) {
    try {
      return await sendOffscreenMessage(message);
    } catch (error) {
      lastError = error;
      if (!/Receiving end does not exist|message port closed/i.test(error?.message || "")) {
        throw error;
      }
      await delay(OFFSCREEN_MESSAGE_RETRY_DELAY_MS);
    }
  }
  throw lastError || new Error("Offscreen inference document did not respond.");
}

function mergeModelState(nextState) {
  if (!nextState) return;
  modelState = {
    ...modelState,
    ...nextState,
  };
}

async function getOffscreenStatus() {
  await ensureOffscreenDocument();
  const response = await sendOffscreenMessageWithRetry({ type: "toxicShield:getOffscreenStatus" });
  mergeModelState(response.model);
  return modelState;
}

async function predictTexts(texts, batchSize = DEFAULT_BATCH_SIZE, tabId = null) {
  await ensureOffscreenDocument();
  const response = await sendOffscreenMessageWithRetry({
    type: "toxicShield:offscreenPredict",
    texts,
    batchSize,
    tabId,
  });
  mergeModelState(response.model);
  return response.results || [];
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(TARGET_HOST_KEY).then((stored) => {
    if (!stored[TARGET_HOST_KEY]) {
      chrome.storage.local.set({ [TARGET_HOST_KEY]: {} });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "toxicShield:getOffscreenStatus") return false;
  if (message.type === "toxicShield:offscreenPredict") return false;

  (async () => {
    const tabId = message.tabId || sender.tab?.id;
    const hostname = message.hostname || "";

    if (message.type === "toxicShield:ensureContentScript") {
      const result = await ensureContentScriptInjected(tabId, message.url || (hostname ? `https://${hostname}/` : ""));
      sendResponse(result);
      return;
    }

    if (message.type === "toxicShield:offscreenProgress") {
      mergeModelState(message.model);
      updateRuntimeProgress(message.progress || {});
      sendResponse({ ok: true, progress: runtimeProgress, model: modelState });
      return;
    }

    if (message.type === "toxicShield:getQuickStatus") {
      const enabled = hostname ? await isSiteEnabled(hostname) : true;
      sendResponse({ ...getStatusPayload(tabId, hostname), site_enabled: enabled });
      return;
    }

    if (message.type === "toxicShield:getStatus") {
      const enabled = hostname ? await isSiteEnabled(hostname) : true;
      sendResponse({ ...getStatusPayload(tabId, hostname), site_enabled: enabled });
      return;
    }

    if (message.type === "toxicShield:setSiteEnabled") {
      await setSiteEnabled(hostname, message.enabled);
      if (tabId) {
        sendTabMessageSafely(tabId, {
          type: "toxicShield:settingsChanged",
          enabled: Boolean(message.enabled),
        });
      }
      sendResponse({ ok: true, site_enabled: Boolean(message.enabled) });
      return;
    }

    if (message.type === "toxicShield:predict") {
      if (!(await isSiteEnabled(hostname))) {
        updateRuntimeProgress({
          phase: "idle",
          message: "Scanning is disabled for this site.",
          current: 0,
          total: 0,
          tabId,
        });
        sendResponse({ disabled: true, results: [] });
        return;
      }
      const texts = Array.isArray(message.texts) ? message.texts : [];
      updateRuntimeProgress({
        phase: "queued",
        message: `Queued ${texts.length} candidate comment(s) for local inference.`,
        current: 0,
        total: texts.length,
        tabId,
      });
      updateRuntimeProgress({
        phase: "predicting",
        message: `Starting offline inference for ${texts.length} candidate comment(s).`,
        current: 0,
        total: texts.length,
        tabId,
      });
      const results = await predictTexts(texts, Number(message.batchSize || DEFAULT_BATCH_SIZE), tabId);
      if (tabId) BG_UPDATE_STATS_WITH_RESULTS(statsForTab(tabId), results);
      updateRuntimeProgress({
        phase: "idle",
        message: `Scan complete for ${texts.length} candidate comment(s).`,
        current: texts.length,
        total: texts.length,
        tabId,
      });
      sendResponse({ disabled: false, results, model: modelState });
      return;
    }

    if (message.type === "toxicShield:scanReport") {
      if (tabId) BG_UPDATE_STATS_WITH_SCAN_REPORT(statsForTab(tabId), message.report || {});
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "toxicShield:resetStats") {
      if (tabId) tabStats.set(tabId, BG_MAKE_INITIAL_STATS());
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ error: `Unknown message type: ${message.type}` });
  })().catch((error) => {
    const tabId = message.tabId || sender.tab?.id || null;
    updateRuntimeProgress({
      phase: "error",
      message: error?.message || String(error),
      tabId,
    });
    mergeModelState({
      status: "error",
      backend: modelState.backend,
      error: error?.message || String(error),
      loadedAt: modelState.loadedAt,
    });
    sendResponse({ error: error?.message || String(error), model: modelState });
  });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStats.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  injectSupportedTabIfNeeded(tabId, tab?.url || "").catch((error) => {
    console.debug("Toxic Shield tab update injection skipped:", error?.message || String(error));
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    const error = chrome.runtime.lastError;
    if (error) return;
    injectSupportedTabIfNeeded(activeInfo.tabId, tab?.url || "").catch((innerError) => {
      console.debug("Toxic Shield tab activation injection skipped:", innerError?.message || String(innerError));
    });
  });
});

if (typeof BG_SHARED.LABELS === "undefined") {
  console.debug("Toxic Shield shared labels were not loaded.");
}
