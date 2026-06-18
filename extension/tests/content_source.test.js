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
  assert.match(source, /candidate_count:\s*candidates\.length/);
});

test("popup polls transient content states instead of reading once after injection", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

  assert.match(source, /CONTENT_STATUS_TIMEOUT_MS\s*=\s*(8000|10000)/);
  assert.match(source, /TRANSIENT_CONTENT_STATUSES/);
  assert.match(source, /pollContentStatus/);
  assert.match(source, /starting|injected|scheduled|predicting/);
});
