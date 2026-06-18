const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatPredictionResults,
  makeInitialStats,
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
