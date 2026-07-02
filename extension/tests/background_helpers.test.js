const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatPredictionResults,
  makeInitialProgress,
  makeInitialStats,
  updateProgress,
  updateStatsWithResults,
  updateStatsWithScanReport,
} = require("../background_helpers.js");

test("background helpers format logits as extension prediction results", () => {
  const thresholds = {
    toxic: 0.73,
    severe_toxic: 0.58,
    obscene: 0.66,
    threat: 0.68,
    insult: 0.68,
    identity_hate: 0.59,
  };

  const results = formatPredictionResults(
    [
      [3, -5, -5, -5, -5, -5],
      [-5, -5, -5, 2, -5, -5],
    ],
    thresholds,
  );

  assert.equal(results[0].action, "block");
  assert.equal(results[0].highest_label, "toxic");
  assert.equal(results[0].risk_level, "high");
  assert.equal(results[1].action, "block");
  assert.equal(results[1].highest_label, "threat");
  assert.ok(results[1].probabilities.threat > 0.8);
});

test("background helpers update content-script counters", () => {
  const stats = makeInitialStats();
  updateStatsWithResults(stats, [
    { action: "allow" },
    { action: "review" },
    { action: "block" },
  ]);

  assert.equal(stats.scanned, 3);
  assert.equal(stats.marked, 1);
  assert.equal(stats.blocked, 1);
});

test("background helpers preserve latest content-script scan diagnostics", () => {
  const stats = makeInitialStats();

  updateStatsWithScanReport(stats, {
    status: "no_candidates",
    candidate_count: 0,
    adapter_id: "youtube",
  });
  updateStatsWithScanReport(stats, {
    status: "prediction_error",
    candidate_count: 3,
    error: "Model failed to load",
  });

  assert.equal(stats.lastScanStatus, "prediction_error");
  assert.equal(stats.lastCandidateCount, 3);
  assert.equal(stats.lastAdapterId, "youtube");
  assert.equal(stats.lastScanError, "Model failed to load");
  assert.ok(stats.lastContentAt);
});

test("background helpers track runtime progress without comment text", () => {
  const progress = makeInitialProgress();

  updateProgress(progress, {
    phase: "running_batch",
    message: "Running ONNX inference 8 comments",
    current: 2,
    total: 3,
    tabId: 42,
    text: "this raw comment must not be retained",
  });

  assert.equal(progress.phase, "running_batch");
  assert.equal(progress.message, "Running ONNX inference 8 comments");
  assert.equal(progress.current, 2);
  assert.equal(progress.total, 3);
  assert.equal(progress.tabId, 42);
  assert.ok(progress.updatedAt);
  assert.equal(Object.hasOwn(progress, "text"), false);

  updateProgress(progress, { phase: "idle", message: "Scan complete" });
  assert.equal(progress.phase, "idle");
  assert.equal(progress.message, "Scan complete");
});
test("background helpers retain queue and cache scan diagnostics", () => {
  const stats = makeInitialStats();

  updateStatsWithScanReport(stats, {
    status: "queued",
    candidate_count: 32,
    pending_count: 12,
    cache_hit_count: 9,
    cache_miss_count: 23,
    fast_allow_count: 2,
  });

  assert.equal(stats.lastScanStatus, "queued");
  assert.equal(stats.lastCandidateCount, 32);
  assert.equal(stats.lastPendingCount, 12);
  assert.equal(stats.lastCacheHitCount, 9);
  assert.equal(stats.lastCacheMissCount, 23);
  assert.equal(stats.lastFastAllowCount, 2);
});
