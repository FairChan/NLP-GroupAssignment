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

test("manifest enables offscreen inference without broadening host scope", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));

  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
});

test("offscreen inference document loads ONNX runtime and inference scripts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "offscreen.html"), "utf8");

  assert.match(html, /vendor\/onnxruntime-web\/ort\.min\.js/);
  assert.match(html, /shared\.js/);
  assert.match(html, /tokenizer\.js/);
  assert.match(html, /background_helpers\.js/);
  assert.match(html, /offscreen_inference\.js/);
});

test("offscreen inference script handles model loading and prediction messages", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "offscreen_inference.js"), "utf8");

  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(source, /InferenceSession\.create/);
  assert.match(source, /toxicShield:offscreenPredict/);
  assert.match(source, /toxicShield:getOffscreenStatus/);
  assert.match(source, /formatPredictionResults/);
});

test("offscreen inference reports model and batch progress without raw texts", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "offscreen_inference.js"), "utf8");

  assert.match(source, /toxicShield:offscreenProgress/);
  assert.match(source, /configuring_ort/);
  assert.match(source, /loading_tokenizer/);
  assert.match(source, /loading_model_file/);
  assert.match(source, /creating_session/);
  assert.match(source, /tokenizing/);
  assert.match(source, /running_batch/);
  assert.match(source, /formatting_results/);
  assert.match(source, /currentBatch|current/);
  assert.match(source, /totalBatches|total/);
  assert.ok(!source.includes("progress: { texts"), "progress messages must not include raw comment text arrays");
});

test("offscreen inference records timing and prefers WebGPU before WASM fallback", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "offscreen_inference.js"), "utf8");

  assert.match(source, /"webgpu"/);
  assert.match(source, /"wasm"/);
  assert.ok(source.indexOf('"webgpu"') < source.indexOf('"wasm"'), "WebGPU should be attempted before WASM");
  assert.match(source, /performance\.now/);
  assert.match(source, /tokenizeMs/);
  assert.match(source, /inferenceMs/);
  assert.match(source, /formatMs/);
  assert.match(source, /totalMs/);
  assert.match(source, /lastTiming/);
});

test("offscreen inference scripts share a document scope without duplicate bindings", () => {
  parseCombinedSources(
    "vendor/onnxruntime-web/ort.min.js",
    "shared.js",
    "tokenizer.js",
    "background_helpers.js",
    "offscreen_inference.js",
  );
});
