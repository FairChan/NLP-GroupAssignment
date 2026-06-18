(() => {
if (globalThis.__toxicShieldContentLoaded) {
  try {
    const manifest = chrome.runtime.getManifest?.();
    document.documentElement.dataset.toxicShieldInjected = manifest?.version || "unknown";
    document.documentElement.dataset.toxicShieldInjectedAt = new Date().toISOString();
  } catch {
    document.documentElement.dataset.toxicShieldInjected = "unknown";
  }
  if (typeof globalThis.__toxicShieldScheduleScan === "function") {
    globalThis.__toxicShieldScheduleScan();
  }
  return;
}
globalThis.__toxicShieldContentLoaded = true;

let processed = new WeakSet();
const predictionCache = new Map();
let scanTimer = null;
let siteEnabled = true;
const SITE_ADAPTERS_LIB = globalThis.ToxicShieldSiteAdapters ?? {};
let lastContentStatus = {
  status: "starting",
  candidate_count: 0,
  processed_count: 0,
  blocked_count: 0,
  marked_count: 0,
  adapter_id: null,
  error: null,
  updated_at: null,
};

function markContentScriptInjected() {
  try {
    const manifest = chrome.runtime.getManifest?.();
    document.documentElement.dataset.toxicShieldInjected = manifest?.version || "unknown";
    document.documentElement.dataset.toxicShieldInjectedAt = new Date().toISOString();
  } catch {
    document.documentElement.dataset.toxicShieldInjected = "unknown";
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        hostname: window.location.hostname,
        ...message,
      },
      (response) => {
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
      },
    );
  });
}

function buildBadge(result) {
  const badge = document.createElement("div");
  badge.className = "toxic-detector-badge";
  const score = Number(result.highest_score || 0);
  badge.textContent = `${result.action.toUpperCase()} | ${result.highest_label} ${(score * 100).toFixed(0)}%`;
  return badge;
}

function updateContentStatus(status) {
  lastContentStatus = {
    ...lastContentStatus,
    ...status,
    updated_at: new Date().toISOString(),
  };
}

function reportScan(status) {
  updateContentStatus(status);
  return sendMessage({
    type: "toxicShield:scanReport",
    report: lastContentStatus,
  }).catch((error) => {
    console.debug("Toxic Shield scan report unavailable:", error.message);
  });
}

function markProcessed(candidates) {
  candidates.forEach((candidate) => {
    if (candidate?.node) processed.add(candidate.node);
  });
}

function applyReview(node, result) {
  if (node.dataset.toxicDetectorAction) return;
  node.classList.add("toxic-detector-review");
  node.dataset.toxicDetectorAction = result.action;
  node.prepend(buildBadge(result));
}

function applyBlock(node, result) {
  if (node.dataset.toxicDetectorAction) return;
  const wrapper = document.createElement("div");
  wrapper.className = "toxic-detector-wrapper";

  const originalParent = node.parentNode;
  if (!originalParent) return;

  originalParent.insertBefore(wrapper, node);
  wrapper.appendChild(node);
  node.classList.add("toxic-detector-blurred");
  node.dataset.toxicDetectorAction = result.action;

  const overlay = document.createElement("div");
  overlay.className = "toxic-detector-overlay";
  const score = Number(result.highest_score || 0);
  overlay.innerHTML = `
    <strong>Hidden high-risk comment</strong>
    <span>${result.highest_label} ${(score * 100).toFixed(0)}%</span>
    <button type="button">Show anyway</button>
  `;
  overlay.querySelector("button").addEventListener("click", () => {
    node.classList.remove("toxic-detector-blurred");
    overlay.remove();
  });
  wrapper.appendChild(overlay);
}

function applyResult(candidate, result) {
  if (!result.flagged || result.action === "allow") return;
  if (result.action === "block") {
    applyBlock(candidate.node, result);
    return;
  }
  applyReview(candidate.node, result);
}

async function getPredictions(candidates) {
  const uncachedTexts = [];
  candidates.forEach((candidate, index) => {
    if (!predictionCache.has(candidate.text)) {
      uncachedTexts.push(candidate.text);
    }
  });

  if (uncachedTexts.length) {
    const payload = await sendMessage({
      type: "toxicShield:predict",
      texts: uncachedTexts,
      batchSize: 8,
    });
    if (payload.disabled) {
      siteEnabled = false;
      return [];
    }
    payload.results.forEach((result, index) => {
      predictionCache.set(uncachedTexts[index], result);
    });
  }

  return candidates.map((candidate) => predictionCache.get(candidate.text) || null);
}

async function scanPage() {
  if (!siteEnabled) {
    await reportScan({
      status: "disabled",
      candidate_count: 0,
      error: null,
    });
    return;
  }
  if (typeof SITE_ADAPTERS_LIB.collectCommentCandidates !== "function") {
    await reportScan({
      status: "adapter_missing",
      candidate_count: 0,
      adapter_id: null,
      error: "site_adapters.js did not expose ToxicShieldSiteAdapters",
    });
    return;
  }

  const adapter = SITE_ADAPTERS_LIB.getAdapterForHostname?.(window.location.hostname);
  const adapterId = adapter?.id || "unknown";
  const candidates = SITE_ADAPTERS_LIB.collectCommentCandidates(document, window.location.hostname, processed);
  if (!candidates.length) {
    await reportScan({
      status: lastContentStatus.status === "scanned" ? "idle" : "no_candidates",
      candidate_count: 0,
      processed_count: 0,
      blocked_count: 0,
      marked_count: 0,
      adapter_id: adapterId,
      error: null,
    });
    return;
  }

  try {
    await reportScan({
      status: "collecting_done",
      candidate_count: candidates.length,
      processed_count: 0,
      blocked_count: 0,
      marked_count: 0,
      adapter_id: adapterId,
      error: null,
    });
    await reportScan({
      status: "predicting",
      candidate_count: candidates.length,
      processed_count: 0,
      blocked_count: 0,
      marked_count: 0,
      adapter_id: adapterId,
      error: null,
    });
    const results = await getPredictions(candidates);
    let blockedCount = 0;
    let markedCount = 0;
    results.forEach((result, index) => {
      const candidate = candidates[index];
      if (candidate && result) {
        if (result.action === "block") blockedCount += 1;
        if (result.action === "review") markedCount += 1;
        applyResult(candidate, result);
      }
    });
    markProcessed(candidates);
    await reportScan({
      status: "scanned",
      candidate_count: candidates.length,
      processed_count: results.filter(Boolean).length,
      blocked_count: blockedCount,
      marked_count: markedCount,
      adapter_id: adapterId,
      error: null,
    });
  } catch (error) {
    await reportScan({
      status: "prediction_error",
      candidate_count: candidates.length,
      processed_count: 0,
      blocked_count: 0,
      marked_count: 0,
      adapter_id: adapterId,
      error: error.message,
    });
    console.debug("Toxic Shield unavailable:", error.message);
  }
}

function scheduleScan() {
  window.clearTimeout(scanTimer);
  if (lastContentStatus.status !== "predicting") {
    reportScan({
      status: "scheduled",
      candidate_count: lastContentStatus.candidate_count || 0,
      adapter_id: lastContentStatus.adapter_id,
      error: null,
    });
  }
  scanTimer = window.setTimeout(scanPage, 700);
}

async function refreshSiteStatus() {
  try {
    const status = await sendMessage({ type: "toxicShield:getStatus" });
    siteEnabled = status.site_enabled !== false;
  } catch (error) {
    console.debug("Toxic Shield status unavailable:", error.message);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "toxicShield:rescan") {
    processed = new WeakSet();
    predictionCache.clear();
    siteEnabled = true;
    sendMessage({ type: "toxicShield:resetStats" }).finally(scheduleScan);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "toxicShield:getContentStatus") {
    sendResponse({ ok: true, content: lastContentStatus });
    return;
  }

  if (message.type === "toxicShield:settingsChanged") {
    siteEnabled = message.enabled !== false;
    if (siteEnabled) {
      processed = new WeakSet();
      scheduleScan();
    }
    sendResponse({ ok: true });
  }
});

markContentScriptInjected();
globalThis.__toxicShieldScheduleScan = scheduleScan;
reportScan({
  status: "injected",
  candidate_count: 0,
  adapter_id: null,
  error: null,
});
refreshSiteStatus().finally(scheduleScan);
const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true });
})();
