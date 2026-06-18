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
    lastAdapterId: null,
  };
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
  stats.lastAdapterId = report?.adapter_id || report?.adapterId || stats.lastAdapterId || null;
  return stats;
}

if (typeof module !== "undefined") {
  module.exports = {
    LABELS: LABELS_REF,
    formatPredictionResults,
    makeInitialStats,
    updateStatsWithResults,
    updateStatsWithScanReport,
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.ToxicShieldBackgroundHelpers = {
    LABELS: LABELS_REF,
    formatPredictionResults,
    makeInitialStats,
    updateStatsWithResults,
    updateStatsWithScanReport,
  };
}
