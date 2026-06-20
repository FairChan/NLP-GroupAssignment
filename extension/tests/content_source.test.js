const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("content script reports scan diagnostics and exposes content status to popup", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

  assert.match(source, /toxicShield:scanReport/);
  assert.match(source, /toxicShield:getContentStatus/);
  assert.match(source, /adapter_missing|prediction_error|no_candidates|idle/);
  assert.match(source, /data-toxic-shield-injected|toxicShieldInjected/);
});

test("popup requests active-tab injection when the content script is missing", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

  assert.match(source, /toxicShield:ensureContentScript/);
  assert.match(source, /injectionError/);
  assert.match(source, /readContentStatus\(activeTab\)/);
  assert.match(source, /sendTabMessage\(tab\.id, \{ type: "toxicShield:getContentStatus" \}\)/);
});

test("content script reports injected and scheduled states before prediction", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

  assert.match(source, /status:\s*"injected"/);
  assert.match(source, /status:\s*"scheduled"/);
  assert.match(source, /status:\s*"collecting_done"/);
  assert.match(source, /status:\s*"predicting"/);
  assert.match(source, /status:\s*"scanned"/);
  assert.match(source, /candidate_count:\s*candidates\.length/);
  assert.match(source, /processed_count/);
  assert.match(source, /blocked_count/);
  assert.match(source, /marked_count/);
});

test("popup polls transient content states instead of reading once after injection", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

  assert.match(source, /CONTENT_STATUS_TIMEOUT_MS\s*=\s*(8000|10000)/);
  assert.match(source, /TRANSIENT_CONTENT_STATUSES/);
  assert.match(source, /pollContentStatus/);
  assert.match(source, /starting|injected|scheduled|predicting/);
});

test("popup renders cached quick status before polling slower status", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

  assert.match(source, /toxicShield:getQuickStatus/);
  assert.match(source, /renderProgress/);
  assert.match(source, /modelProgress/);
  assert.match(source, /scannerProgress/);
  assert.match(source, /runtimeProgress/);

  const firstQuickStatus = source.indexOf("toxicShield:getQuickStatus");
  const firstFullStatus = source.indexOf("toxicShield:getStatus");
  assert.ok(firstQuickStatus >= 0, "popup must request quick status");
  assert.ok(firstFullStatus >= 0, "popup must still support full status refresh");
  assert.ok(firstQuickStatus < firstFullStatus, "quick status should be requested before full status");
});
test("content script coalesces scan storms and reports cache efficiency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

  assert.match(source, /scanInFlight/);
  assert.match(source, /pendingScan/);
  assert.match(source, /MAX_CANDIDATES_PER_SCAN/);
  assert.match(source, /MAX_PREDICTION_CACHE_ENTRIES/);
  assert.match(source, /status:\s*"queued"/);
  assert.match(source, /cache_hit_count/);
  assert.match(source, /cache_miss_count/);
  assert.match(source, /pending_count/);
  assert.match(source, /trimPredictionCache/);
  assert.match(source, /markProcessed\(predictedCandidates\)/);
});
test("popup surfaces cache and queue diagnostics", () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
  const popupSource = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

  assert.match(popupHtml, /id="cache"/);
  assert.match(popupSource, /cacheEl/);
  assert.match(popupSource, /cache_hit_count/);
  assert.match(popupSource, /cache_miss_count/);
  assert.match(popupSource, /pending_count/);
});
