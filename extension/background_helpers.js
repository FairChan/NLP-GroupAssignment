let sharedExports = {};
if (typeof require !== "undefined") {
  sharedExports = require("./shared.js");
} else if (typeof globalThis !== "undefined" && globalThis.ToxicShieldShared) {
  sharedExports = globalThis.ToxicShieldShared;
}

const LABELS_REF = typeof LABELS !== "undefined" ? LABELS : sharedExports.LABELS;
const probabilitiesFromLogitsRef =
  typeof probabilitiesFromLogits !== "undefined"
    ? probabilitiesFromLogits
    : sharedExports.probabilitiesFromLogits;
const decideModerationRef =
  typeof decideModeration !== "undefined" ? decideModeration : sharedExports.decideModeration;

function toSnakeCaseResult(result) {
  return {
    flagged: result.flagged,
    flagged_labels: result.flaggedLabels,
    highest_label: result.highestLabel,
    highest_score: result.highestScore,
    risk_level: result.riskLevel,
    action: result.action,
  };
}

function formatPredictionResults(logitRows, thresholds) {
  return logitRows.map((logits) => {
    const probabilities = probabilitiesFromLogitsRef(logits);
    const decision = decideModerationRef(probabilities, thresholds);
    return {
      probabilities,
      ...toSnakeCaseResult(decision),
    };
  });
}

function makeInitialStats() {
  return {
    scanned: 0,
    blocked: 0,
    marked: 0,
    lastScanAt: null,
    lastContentAt: null,
    lastScanStatus: "not_injected",
    lastScanError: null,
    lastCandidateCount: 0,
    lastProcessedCount: 0,
    lastBlockedCount: 0,
    lastMarkedCount: 0,
    lastAdapterId: null,
  };
}

function makeInitialProgress() {
  return {
    phase: "idle",
    message: "Waiting for page activity.",
    current: 0,
    total: 0,
    tabId: null,
    updatedAt: null,
  };
}

function updateProgress(progress, patch) {
  const target = progress || makeInitialProgress();
  const next = patch || {};
  if (next.phase !== undefined) target.phase = String(next.phase || "idle");
  if (next.message !== undefined) target.message = String(next.message || "");
  if (next.current !== undefined) target.current = Math.max(0, Number(next.current) || 0);
  if (next.total !== undefined) target.total = Math.max(0, Number(next.total) || 0);
  if (next.tabId !== undefined) {
    const numericTabId = Number(next.tabId);
    target.tabId = Number.isFinite(numericTabId) ? numericTabId : null;
  }
  target.updatedAt = new Date().toISOString();
  return target;
}

function updateStatsWithResults(stats, results) {
  stats.scanned += results.length;
  stats.blocked += results.filter((result) => result.action === "block").length;
  stats.marked += results.filter((result) => result.action === "review").length;
  stats.lastScanAt = new Date().toISOString();
  return stats;
}

function updateStatsWithScanReport(stats, report) {
  stats.lastContentAt = new Date().toISOString();
  stats.lastScanStatus = String(report?.status || "unknown");
  stats.lastScanError = report?.error ? String(report.error) : null;
  stats.lastCandidateCount = Number(report?.candidate_count ?? report?.candidateCount ?? 0);
  stats.lastProcessedCount = Number(report?.processed_count ?? report?.processedCount ?? stats.lastProcessedCount ?? 0);
  stats.lastBlockedCount = Number(report?.blocked_count ?? report?.blockedCount ?? stats.lastBlockedCount ?? 0);
  stats.lastMarkedCount = Number(report?.marked_count ?? report?.markedCount ?? stats.lastMarkedCount ?? 0);
  stats.lastAdapterId = report?.adapter_id || report?.adapterId || stats.lastAdapterId || null;
  return stats;
}

if (typeof module !== "undefined") {
  module.exports = {
    LABELS: LABELS_REF,
    formatPredictionResults,
    makeInitialProgress,
    makeInitialStats,
    updateProgress,
    updateStatsWithResults,
    updateStatsWithScanReport,
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.ToxicShieldBackgroundHelpers = {
    LABELS: LABELS_REF,
    formatPredictionResults,
    makeInitialProgress,
    makeInitialStats,
    updateProgress,
    updateStatsWithResults,
    updateStatsWithScanReport,
  };
}
