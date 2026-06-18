const OFFSCREEN_SHARED = globalThis.ToxicShieldShared ?? {};
const OFFSCREEN_TOKENIZER_LIB = globalThis.ToxicShieldTokenizer ?? {};
const OFFSCREEN_HELPERS = globalThis.ToxicShieldBackgroundHelpers ?? {};

const OFFSCREEN_CREATE_WORDPIECE_TOKENIZER = OFFSCREEN_TOKENIZER_LIB.createWordPieceTokenizer;
const OFFSCREEN_FORMAT_PREDICTION_RESULTS = OFFSCREEN_HELPERS.formatPredictionResults;

const MODEL_DIR = "model";
const DEFAULT_BATCH_SIZE = 8;
const OFFSCREEN_MESSAGE_TYPES = new Set([
  "toxicShield:getOffscreenStatus",
  "toxicShield:offscreenPredict",
]);

let session = null;
let tokenizer = null;
let thresholds = null;
let trainingConfig = null;
let modelLoadPromise = null;
let modelState = {
  status: "idle",
  backend: null,
  error: null,
  loadedAt: null,
};

function runtimeUrl(path) {
  return chrome.runtime.getURL(path);
}

async function fetchJson(path) {
  const response = await fetch(runtimeUrl(path));
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return response.json();
}

async function fetchBytes(path) {
  const response = await fetch(runtimeUrl(path));
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchModelBytes() {
  try {
    return await fetchBytes(`${MODEL_DIR}/model_quantized.onnx`);
  } catch {
    return fetchBytes(`${MODEL_DIR}/model.onnx`);
  }
}

function getMaxLength() {
  return Number(trainingConfig?.max_length || trainingConfig?.maxLength || 256);
}

function getHeadTokens() {
  return Number(trainingConfig?.head_tokens || trainingConfig?.headTokens || 200);
}

function getTailTokens() {
  return Number(trainingConfig?.tail_tokens || trainingConfig?.tailTokens || 50);
}

function configureOrt() {
  ort.env.logLevel = "warning";
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = runtimeUrl("vendor/onnxruntime-web/");
}

async function createSession(modelBytes) {
  let lastError = null;
  for (const provider of ["wasm"]) {
    try {
      const created = await ort.InferenceSession.create(modelBytes, {
        executionProviders: [provider],
        graphOptimizationLevel: "all",
      });
      modelState.backend = provider;
      return created;
    } catch (error) {
      lastError = error;
      console.debug(`Toxic Shield failed to initialize ${provider}:`, error);
    }
  }
  throw lastError || new Error("No ONNX Runtime backend was available.");
}

async function loadModel() {
  if (session && tokenizer && thresholds) return;
  if (modelLoadPromise) return modelLoadPromise;

  modelState = {
    status: "loading",
    backend: null,
    error: null,
    loadedAt: null,
  };
  modelLoadPromise = (async () => {
    try {
      configureOrt();
      const [tokenizerJson, loadedThresholds, loadedTrainingConfig, modelBytes] = await Promise.all([
        fetchJson(`${MODEL_DIR}/tokenizer.json`),
        fetchJson(`${MODEL_DIR}/thresholds.json`),
        fetchJson(`${MODEL_DIR}/training_config.json`),
        fetchModelBytes(),
      ]);
      trainingConfig = loadedTrainingConfig;
      thresholds = loadedThresholds;
      tokenizer = OFFSCREEN_CREATE_WORDPIECE_TOKENIZER(tokenizerJson, {
        maxLength: getMaxLength(),
        headTokens: getHeadTokens(),
        tailTokens: getTailTokens(),
      });
      session = await createSession(modelBytes);
      modelState.status = "ready";
      modelState.error = null;
      modelState.loadedAt = new Date().toISOString();
    } catch (error) {
      modelState.status = "error";
      modelState.error = error?.message || String(error);
      session = null;
      tokenizer = null;
      thresholds = null;
      throw error;
    } finally {
      modelLoadPromise = null;
    }
  })();
  return modelLoadPromise;
}

function flattenBigInt(rows, field) {
  const width = rows[0][field].length;
  const data = new BigInt64Array(rows.length * width);
  rows.forEach((row, rowIndex) => {
    row[field].forEach((value, columnIndex) => {
      data[rowIndex * width + columnIndex] = BigInt(value);
    });
  });
  return data;
}

async function runBatch(texts) {
  const encodedRows = tokenizer.encodeBatch(texts);
  const maxLength = getMaxLength();
  const feeds = {
    input_ids: new ort.Tensor("int64", flattenBigInt(encodedRows, "inputIds"), [texts.length, maxLength]),
    attention_mask: new ort.Tensor("int64", flattenBigInt(encodedRows, "attentionMask"), [
      texts.length,
      maxLength,
    ]),
  };
  const outputs = await session.run(feeds);
  const logitsTensor = outputs.logits || outputs[session.outputNames?.[0]];
  const logits = Array.from(logitsTensor.data);
  const labelCount = OFFSCREEN_SHARED.LABELS.length;
  const rows = [];
  for (let offset = 0; offset < logits.length; offset += labelCount) {
    rows.push(logits.slice(offset, offset + labelCount));
  }
  return OFFSCREEN_FORMAT_PREDICTION_RESULTS(rows, thresholds);
}

async function predictTexts(texts, batchSize = DEFAULT_BATCH_SIZE) {
  await loadModel();
  const normalizedTexts = texts.map((text) => String(text || "").trim());
  const results = [];
  for (let start = 0; start < normalizedTexts.length; start += batchSize) {
    const batch = normalizedTexts.slice(start, start + batchSize);
    results.push(...(await runBatch(batch)));
  }
  return results;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!OFFSCREEN_MESSAGE_TYPES.has(message.type)) return false;

  (async () => {
    if (message.type === "toxicShield:getOffscreenStatus") {
      sendResponse({ ok: true, model: modelState });
      return;
    }

    if (message.type === "toxicShield:offscreenPredict") {
      const texts = Array.isArray(message.texts) ? message.texts : [];
      const results = await predictTexts(texts, Number(message.batchSize || DEFAULT_BATCH_SIZE));
      sendResponse({ ok: true, results, model: modelState });
    }
  })().catch((error) => {
    modelState = {
      ...modelState,
      status: "error",
      error: error?.message || String(error),
    };
    sendResponse({ error: error?.message || String(error), model: modelState });
  });
  return true;
});
