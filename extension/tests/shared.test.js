const test = require("node:test");
const assert = require("node:assert/strict");

const { LABELS, sigmoid, decideModeration } = require("../shared.js");

test("sigmoid converts logits to probabilities", () => {
  assert.equal(sigmoid(0), 0.5);
  assert.ok(sigmoid(4) > 0.98);
  assert.ok(sigmoid(-4) < 0.02);
});

test("decision blocks high probability toxic comments", () => {
  const thresholds = {
    toxic: 0.73,
    severe_toxic: 0.58,
    obscene: 0.66,
    threat: 0.68,
    insult: 0.68,
    identity_hate: 0.59,
  };
  const probabilities = Object.fromEntries(LABELS.map((label) => [label, 0.01]));
  probabilities.toxic = 0.95;

  const decision = decideModeration(probabilities, thresholds);

  assert.equal(decision.flagged, true);
  assert.equal(decision.action, "block");
  assert.equal(decision.riskLevel, "high");
  assert.equal(decision.highestLabel, "toxic");
  assert.deepEqual(decision.flaggedLabels, ["toxic"]);
});

test("decision reviews medium risk comments without blocking", () => {
  const thresholds = {
    toxic: 0.73,
    severe_toxic: 0.58,
    obscene: 0.66,
    threat: 0.68,
    insult: 0.68,
    identity_hate: 0.59,
  };
  const probabilities = Object.fromEntries(LABELS.map((label) => [label, 0.01]));
  probabilities.insult = 0.7;

  const decision = decideModeration(probabilities, thresholds);

  assert.equal(decision.flagged, true);
  assert.equal(decision.action, "review");
  assert.equal(decision.riskLevel, "medium");
});
