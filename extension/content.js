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

const MAX_CANDIDATES_PER_SCAN = 32;
const MAX_PREDICTION_CACHE_ENTRIES = 1500;
const RESCAN_AFTER_BACKLOG_MS = 250;
const FAST_RESCAN_DELAY_MS = 80;
const SCAN_DEBOUNCE_MS = 700;
const INITIAL_SCAN_DELAY_MS = 1800;
const DEFAULT_BATCH_SIZE = 8;
const FAST_BATCH_SIZE = 2;
const FAST_PATH_MIN_TEXT_LENGTH = 2;

let processed = new WeakSet();
const predictionCache = new Map();
let scanTimer = null;
let scanInFlight = false;
let pendingScan = false;
let firstScanPending = true;
let siteEnabled = true;
const SITE_ADAPTERS_LIB = globalThis.ToxicShieldSiteAdapters ?? {};
let lastContentStatus = {
  status: "starting",
  candidate_count: 0,
  processed_count: 0,
  blocked_count: 0,
  marked_count: 0,
  pending_count: 0,
  cache_hit_count: 0,
  cache_miss_count: 0,
  cache_size: 0,
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
    cache_size: predictionCache.size,
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

function normalizeTextForCache(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function makeFastAllowResult() {
  const probabilities = {};
  const labels = globalThis.ToxicShieldShared?.LABELS || [
    "toxic",
    "severe_toxic",
    "obscene",
    "threat",
    "insult",
    "identity_hate",
  ];
  labels.forEach((label) => {
    probabilities[label] = 0;
  });
  return {
    probabilities,
    flagged: false,
    flagged_labels: [],
    highest_label: labels[0],
    highest_score: 0,
    risk_level: "low",
    action: "allow",
    fast_path: true,
  };
}

function isFastAllowText(cacheKey) {
  const compact = String(cacheKey || "").replace(/[^a-z0-9]/gi, "");
  return compact.length < FAST_PATH_MIN_TEXT_LENGTH;
}

function isCandidateVisible(candidate) {
  const node = candidate?.node;
  if (!node || typeof node.getBoundingClientRect !== "function") return false;
  const rect = node.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  return rect.bottom >= 0 && rect.right >= 0 && rect.top <= viewportHeight && rect.left <= viewportWidth;
}

function prioritizeCandidates(candidates) {
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  return candidates
    .map((candidate, index) => {
      const rect = candidate?.node?.getBoundingClientRect?.();
      const visible = rect
        ? rect.bottom >= 0 && rect.right >= 0 && rect.top <= viewportHeight && rect.left <= viewportWidth
        : false;
      return {
        candidate,
        index,
        visible,
        top: rect?.top ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => {
      if (left.visible !== right.visible) return left.visible ? -1 : 1;
      if (left.top !== right.top) return left.top - right.top;
      return left.index - right.index;
    })
    .map((item) => item.candidate);
}

function trimPredictionCache() {
  while (predictionCache.size > MAX_PREDICTION_CACHE_ENTRIES) {
    const oldestKey = predictionCache.keys().next().value;
    if (oldestKey === undefined) return;
    predictionCache.delete(oldestKey);
  }
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
  const uncachedKeys = [];
  const queuedTexts = new Set();
  let cacheHits = 0;
  let cacheMisses = 0;
  let fastAllowCount = 0;

  candidates.forEach((candidate) => {
    const cacheKey = candidate.cacheKey || normalizeTextForCache(candidate.text);
    candidate.cacheKey = cacheKey;
    if (predictionCache.has(cacheKey)) {
      cacheHits += 1;
      return;
    }
    if (isFastAllowText(cacheKey)) {
      fastAllowCount += 1;
      predictionCache.set(cacheKey, makeFastAllowResult());
      return;
    }
    cacheMisses += 1;
    if (!queuedTexts.has(cacheKey)) {
      queuedTexts.add(cacheKey);
      uncachedKeys.push(cacheKey);
      uncachedTexts.push(candidate.text);
    }
  });

  if (uncachedTexts.length) {
    const hasSmallVisibleBatch =
      uncachedTexts.length <= FAST_BATCH_SIZE && candidates.some((candidate) => isCandidateVisible(candidate));
    const payload = await sendMessage({
      type: "toxicShield:predict",
      texts: uncachedTexts,
      batchSize: hasSmallVisibleBatch ? FAST_BATCH_SIZE : DEFAULT_BATCH_SIZE,
    });
    if (payload.disabled) {
      siteEnabled = false;
      return { results: [], cacheHits, cacheMisses, fastAllowCount, disabled: true };
    }
    payload.results.forEach((result, index) => {
      predictionCache.set(uncachedKeys[index], result);
    });
  }
  trimPredictionCache();

  return {
    results: candidates.map((candidate) => predictionCache.get(candidate.cacheKey) || null),
    cacheHits,
    cacheMisses,
    fastAllowCount,
    disabled: false,
  };
}
async function scanPage() {
  if (scanInFlight) {
    pendingScan = true;
    await reportScan({
      status: "queued",
      candidate_count: lastContentStatus.candidate_count || 0,
      pending_count: lastContentStatus.pending_count || 0,
      adapter_id: lastContentStatus.adapter_id,
      error: null,
    });
    return;
  }

  scanInFlight = true;
  let shouldScheduleAgain = false;
  try {
    if (!siteEnabled) {
      await reportScan({
        status: "disabled",
        candidate_count: 0,
        pending_count: 0,
        error: null,
      });
      return;
    }
    if (typeof SITE_ADAPTERS_LIB.collectCommentCandidates !== "function") {
      await reportScan({
        status: "adapter_missing",
        candidate_count: 0,
        pending_count: 0,
        adapter_id: null,
        error: "site_adapters.js did not expose ToxicShieldSiteAdapters",
      });
      return;
    }

    const adapter = SITE_ADAPTERS_LIB.getAdapterForHostname?.(window.location.hostname);
    const adapterId = adapter?.id || "unknown";
    const collectedCandidates = SITE_ADAPTERS_LIB.collectCommentCandidates(document, window.location.hostname, processed)
      .map((candidate) => ({
        ...candidate,
        cacheKey: normalizeTextForCache(candidate.text),
      }))
      .filter((candidate) => candidate.cacheKey.length > 0);
    const prioritizedCandidates = prioritizeCandidates(collectedCandidates);
    const candidates = prioritizedCandidates.slice(0, MAX_CANDIDATES_PER_SCAN);
    const pendingCount = Math.max(0, collectedCandidates.length - candidates.length);
    shouldScheduleAgain = pendingCount > 0;

    if (!candidates.length) {
      await reportScan({
        status: lastContentStatus.status === "scanned" ? "idle" : "no_candidates",
        candidate_count: 0,
        processed_count: 0,
        blocked_count: 0,
        marked_count: 0,
        pending_count: 0,
        adapter_id: adapterId,
        error: null,
      });
      return;
    }

    await reportScan({
      status: "collecting_done",
      candidate_count: candidates.length,
      processed_count: 0,
      blocked_count: 0,
      marked_count: 0,
      pending_count: pendingCount,
      adapter_id: adapterId,
      error: null,
    });
    await reportScan({
      status: "predicting",
      candidate_count: candidates.length,
      processed_count: 0,
      blocked_count: 0,
      marked_count: 0,
      pending_count: pendingCount,
      adapter_id: adapterId,
      error: null,
    });

    const predictionPayload = await getPredictions(candidates);
    if (predictionPayload.disabled) return;

    const { results, cacheHits, cacheMisses, fastAllowCount } = predictionPayload;
    let blockedCount = 0;
    let markedCount = 0;
    const predictedCandidates = [];
    results.forEach((result, index) => {
      const candidate = candidates[index];
      if (candidate && result) {
        predictedCandidates.push(candidate);
        if (result.action === "block") blockedCount += 1;
        if (result.action === "review") markedCount += 1;
        applyResult(candidate, result);
      }
    });
    markProcessed(predictedCandidates);
    await reportScan({
      status: "scanned",
      candidate_count: candidates.length,
      processed_count: results.filter(Boolean).length,
      blocked_count: blockedCount,
      marked_count: markedCount,
      pending_count: pendingCount,
      cache_hit_count: cacheHits,
      cache_miss_count: cacheMisses,
      fast_allow_count: fastAllowCount,
      adapter_id: adapterId,
      error: null,
    });
  } catch (error) {
    await reportScan({
      status: "prediction_error",
      candidate_count: lastContentStatus.candidate_count || 0,
      processed_count: 0,
      blocked_count: 0,
      marked_count: 0,
      pending_count: lastContentStatus.pending_count || 0,
      adapter_id: lastContentStatus.adapter_id,
      error: error.message,
    });
    console.debug("Toxic Shield unavailable:", error.message);
  } finally {
    scanInFlight = false;
    if (pendingScan || shouldScheduleAgain) {
      pendingScan = false;
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(scanPage, RESCAN_AFTER_BACKLOG_MS);
    }
  }
}

function scheduleScan(delayMs = SCAN_DEBOUNCE_MS) {
  if (scanInFlight) {
    pendingScan = true;
    reportScan({
      status: "queued",
      candidate_count: lastContentStatus.candidate_count || 0,
      pending_count: lastContentStatus.pending_count || 0,
      adapter_id: lastContentStatus.adapter_id,
      error: null,
    });
    return;
  }

  window.clearTimeout(scanTimer);
  reportScan({
    status: "scheduled",
    candidate_count: lastContentStatus.candidate_count || 0,
    pending_count: lastContentStatus.pending_count || 0,
    adapter_id: lastContentStatus.adapter_id,
    error: null,
  });
  const actualDelay = firstScanPending ? Math.max(delayMs, INITIAL_SCAN_DELAY_MS) : delayMs;
  firstScanPending = false;
  scanTimer = window.setTimeout(scanPage, actualDelay);
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
    pendingScan = false;
    firstScanPending = false;
    siteEnabled = true;
    sendMessage({ type: "toxicShield:resetStats" }).finally(() => scheduleScan(FAST_RESCAN_DELAY_MS));
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
      pendingScan = true;
      scheduleScan(FAST_RESCAN_DELAY_MS);
    }
    sendResponse({ ok: true });
  }
});

markContentScriptInjected();
globalThis.__toxicShieldScheduleScan = scheduleScan;
reportScan({
  status: "injected",
  candidate_count: 0,
  pending_count: 0,
  adapter_id: null,
  error: null,
});
refreshSiteStatus().finally(() => scheduleScan(INITIAL_SCAN_DELAY_MS));
const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true });
})();
