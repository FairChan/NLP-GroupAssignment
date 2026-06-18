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

function sendProgress(progress) {
  try {
    const progressPayload = {
      phase: progress?.phase || "idle",
      message: progress?.message || "",
      current: Number(progress?.current || 0),
      total: Number(progress?.total || 0),
      tabId: progress?.tabId ?? null,
    };
    if (progress?.currentBatch !== undefined) progressPayload.currentBatch = progress.currentBatch;
    if (progress?.totalBatches !== undefined) progressPayload.totalBatches = progress.totalBatches;
    if (progress?.textCount !== undefined) progressPayload.textCount = progress.textCount;
    chrome.runtime.sendMessage(
      {
        type: "toxicShield:offscreenProgress",
        progress: progressPayload,
        model: modelState,
      },
      () => {
        chrome.runtime.lastError;
      },
    );
  } catch {
    // Progress is best-effort; prediction must continue if the popup is closed.
  }
}

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
      sendProgress({
        phase: "configuring_ort",
        message: "Configuring ONNX Runtime Web.",
        current: 0,
        total: 4,
      });
      configureOrt();

      sendProgress({
        phase: "loading_tokenizer",
        message: "Loading tokenizer, thresholds, and training config.",
        current: 1,
        total: 4,
      });
      const [tokenizerJson, loadedThresholds, loadedTrainingConfig] = await Promise.all([
        fetchJson(`${MODEL_DIR}/tokenizer.json`),
        fetchJson(`${MODEL_DIR}/thresholds.json`),
        fetchJson(`${MODEL_DIR}/training_config.json`),
      ]);
      trainingConfig = loadedTrainingConfig;
      thresholds = loadedThresholds;
      tokenizer = OFFSCREEN_CREATE_WORDPIECE_TOKENIZER(tokenizerJson, {
        maxLength: getMaxLength(),
        headTokens: getHeadTokens(),
        tailTokens: getTailTokens(),
      });

      sendProgress({
        phase: "loading_model_file",
        message: "Loading local ONNX model file.",
        current: 2,
        total: 4,
      });
      const modelBytes = await fetchModelBytes();

      sendProgress({
        phase: "creating_session",
        message: "Creating ONNX inference session.",
        current: 3,
        total: 4,
      });
      session = await createSession(modelBytes);
      modelState.status = "ready";
      modelState.error = null;
      modelState.loadedAt = new Date().toISOString();
      sendProgress({
        phase: "ready",
        message: "Offline model ready.",
        current: 4,
        total: 4,
      });
    } catch (error) {
      modelState.status = "error";
      modelState.error = error?.message || String(error);
      session = null;
      tokenizer = null;
      thresholds = null;
      sendProgress({
        phase: "error",
        message: modelState.error,
        current: 0,
        total: 0,
      });
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

async function runBatch(texts, batchProgress) {
  sendProgress({
    phase: "tokenizing",
    message: `Tokenizing batch ${batchProgress.currentBatch}/${batchProgress.totalBatches}.`,
    current: batchProgress.currentBatch,
    total: batchProgress.totalBatches,
    currentBatch: batchProgress.currentBatch,
    totalBatches: batchProgress.totalBatches,
    textCount: texts.length,
    tabId: batchProgress.tabId,
  });
  const encodedRows = tokenizer.encodeBatch(texts);
  const maxLength = getMaxLength();
  const feeds = {
    input_ids: new ort.Tensor("int64", flattenBigInt(encodedRows, "inputIds"), [texts.length, maxLength]),
    attention_mask: new ort.Tensor("int64", flattenBigInt(encodedRows, "attentionMask"), [
      texts.length,
      maxLength,
    ]),
  };
  sendProgress({
    phase: "running_batch",
    message: `Running ONNX inference for ${texts.length} comment(s), batch ${batchProgress.currentBatch}/${batchProgress.totalBatches}.`,
    current: batchProgress.currentBatch,
    total: batchProgress.totalBatches,
    currentBatch: batchProgress.currentBatch,
    totalBatches: batchProgress.totalBatches,
    textCount: texts.length,
    tabId: batchProgress.tabId,
  });
  const outputs = await session.run(feeds);
  const logitsTensor = outputs.logits || outputs[session.outputNames?.[0]];
  const logits = Array.from(logitsTensor.data);
  const labelCount = OFFSCREEN_SHARED.LABELS.length;
  const rows = [];
  for (let offset = 0; offset < logits.length; offset += labelCount) {
    rows.push(logits.slice(offset, offset + labelCount));
  }
  sendProgress({
    phase: "formatting_results",
    message: `Formatting results for batch ${batchProgress.currentBatch}/${batchProgress.totalBatches}.`,
    current: batchProgress.currentBatch,
    total: batchProgress.totalBatches,
    currentBatch: batchProgress.currentBatch,
    totalBatches: batchProgress.totalBatches,
    textCount: texts.length,
    tabId: batchProgress.tabId,
  });
  return OFFSCREEN_FORMAT_PREDICTION_RESULTS(rows, thresholds);
}

async function predictTexts(texts, batchSize = DEFAULT_BATCH_SIZE, tabId = null) {
  await loadModel();
  const normalizedTexts = texts.map((text) => String(text || "").trim());
  const results = [];
  const safeBatchSize = Math.max(1, Number(batchSize || DEFAULT_BATCH_SIZE));
  const totalBatches = Math.max(1, Math.ceil(normalizedTexts.length / safeBatchSize));
  let currentBatch = 0;
  for (let start = 0; start < normalizedTexts.length; start += safeBatchSize) {
    currentBatch += 1;
    const batch = normalizedTexts.slice(start, start + safeBatchSize);
    results.push(...(await runBatch(batch, { currentBatch, totalBatches, tabId })));
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
      const results = await predictTexts(texts, Number(message.batchSize || DEFAULT_BATCH_SIZE), message.tabId ?? null);
      sendResponse({ ok: true, results, model: modelState });
    }
  })().catch((error) => {
    modelState = {
      ...modelState,
      status: "error",
      error: error?.message || String(error),
    };
    sendProgress({
      phase: "error",
      message: modelState.error,
      tabId: message.tabId ?? null,
    });
    sendResponse({ error: error?.message || String(error), model: modelState });
  });
  return true;
});
