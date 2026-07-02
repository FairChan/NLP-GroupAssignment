const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function parseCombinedSources(...files) {
  const source = files
    .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
    .join("\n");
  assert.doesNotThrow(() => new vm.Script(source), `Combined parse failed for ${files.join(", ")}`);
}

test("background worker scripts share a scope without duplicate bindings", () => {
  parseCombinedSources("supported_sites.js", "shared.js", "tokenizer.js", "background_helpers.js", "background.js");
});

test("background shared helpers can be imported more than once without lexical collisions", () => {
  parseCombinedSources("shared.js", "shared.js");
});

test("background worker parses with the real importScripts order without ONNX Runtime", () => {
  parseCombinedSources(
    "supported_sites.js",
    "shared.js",
    "background_helpers.js",
    "background.js",
  );
});

test("content script helpers share a scope without duplicate bindings", () => {
  parseCombinedSources("supported_sites.js", "site_adapters.js", "content.js");
});

test("content script files tolerate a popup-triggered reinjection", () => {
  parseCombinedSources(
    "supported_sites.js",
    "site_adapters.js",
    "content.js",
    "supported_sites.js",
    "site_adapters.js",
    "content.js",
  );
});

test("background script does not reference stale helper binding names", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  assert.ok(!source.includes("makeInitialStats("));
  assert.ok(!source.includes("formatPredictionResults("));
  assert.ok(!source.includes("updateStatsWithResults("));
  assert.ok(!source.includes("createWordPieceTokenizer("));
});

test("background worker delegates ONNX inference to offscreen document", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  assert.ok(!source.includes("ort.min.js"));
  assert.ok(!source.includes("InferenceSession.create"));
  assert.match(source, /chrome\.offscreen\.createDocument/);
  assert.match(source, /toxicShield:offscreenPredict/);
});

test("background can inject content scripts when a supported active tab has not reported", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  assert.match(source, /toxicShield:ensureContentScript/);
  assert.match(source, /chrome\.scripting\.executeScript/);
  assert.match(source, /chrome\.scripting\.insertCSS/);
  assert.match(source, /supported_sites\.js/);
  assert.match(source, /site_adapters\.js/);
  assert.match(source, /content\.js/);
});

test("background has supported-tab injection fallbacks and returns marker diagnostics", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  assert.match(source, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(source, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(source, /markerPresent/);
  assert.match(source, /injectedVersion/);
  assert.match(source, /toxicShieldInjected/);
});

test("background exposes quick cached status without forcing offscreen initialization", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  assert.match(source, /toxicShield:getQuickStatus/);
  assert.match(source, /runtimeProgress/);
  assert.match(source, /toxicShield:offscreenProgress/);
  assert.match(source, /phase:\s*"queued"/);
  assert.match(source, /phase:\s*"predicting"/);
  assert.match(source, /phase:\s*"idle"/);

  const quickStatusIndex = source.indexOf('message.type === "toxicShield:getQuickStatus"');
  const getStatusIndex = source.indexOf('message.type === "toxicShield:getStatus"');
  const quickStatusBlock = source.slice(quickStatusIndex, getStatusIndex);
  assert.ok(quickStatusIndex >= 0, "quick status handler is missing");
  assert.ok(!quickStatusBlock.includes("getOffscreenStatus"), "quick status must not create or await offscreen status");

  const setSiteEnabledIndex = source.indexOf('message.type === "toxicShield:setSiteEnabled"');
  const fullStatusBlock = source.slice(getStatusIndex, setSiteEnabledIndex);
  assert.ok(getStatusIndex >= 0, "full status handler is missing");
  assert.ok(!fullStatusBlock.includes("getOffscreenStatus"), "full status must return cached state for popup speed");
});

test("background preloads the offscreen model only on supported enabled tabs", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  assert.match(source, /preloadModelForSupportedTab/);
  assert.match(source, /scheduleIdlePreload/);
  assert.match(source, /PRELOAD_DELAY_MS/);
  assert.match(source, /preloadTimers/);
  assert.match(source, /toxicShield:preloadModel/);
  assert.match(source, /idle preload/i);
  assert.match(source, /isSupportedContentUrl\(url\)/);
  assert.match(source, /isSiteEnabled\(hostname\)/);

  const updatedIndex = source.indexOf("chrome.tabs.onUpdated.addListener");
  const activatedIndex = source.indexOf("chrome.tabs.onActivated.addListener");
  const tailIndex = source.indexOf("if (typeof BG_SHARED.LABELS");
  const updatedBlock = source.slice(updatedIndex, activatedIndex);
  const activatedBlock = source.slice(activatedIndex, tailIndex);

  assert.match(updatedBlock, /scheduleIdlePreload/);
  assert.match(activatedBlock, /scheduleIdlePreload/);
  assert.ok(!updatedBlock.includes("preloadModelForSupportedTab("));
  assert.ok(!activatedBlock.includes("preloadModelForSupportedTab("));
});

test("background quick status avoids storage and offscreen startup work", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  assert.match(source, /getCachedSiteEnabled/);

  const quickStatusIndex = source.indexOf('message.type === "toxicShield:getQuickStatus"');
  const getStatusIndex = source.indexOf('message.type === "toxicShield:getStatus"');
  const quickStatusBlock = source.slice(quickStatusIndex, getStatusIndex);

  assert.match(quickStatusBlock, /getCachedSiteEnabled/);
  assert.ok(!quickStatusBlock.includes("await isSiteEnabled"), "quick status must not wait for storage");
  assert.ok(!quickStatusBlock.includes("ensureOffscreenDocument"), "quick status must not wake offscreen inference");
});
