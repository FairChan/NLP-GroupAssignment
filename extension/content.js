const API_URL = "http://127.0.0.1:8000/predict";
const COMMENT_SELECTORS = [
  "[data-testid*='comment' i]",
  "[aria-label*='comment' i]",
  "[class*='comment' i]",
  "article",
  "p"
];

const processed = new WeakSet();
let scanTimer = null;

function visibleElement(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest(".toxic-detector-wrapper")) return false;
  if (element.closest("textarea, input, [contenteditable='true']")) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function collectCandidates() {
  const nodes = new Set();
  for (const selector of COMMENT_SELECTORS) {
    document.querySelectorAll(selector).forEach((node) => nodes.add(node));
  }

  const candidates = [];
  for (const node of nodes) {
    if (!visibleElement(node) || processed.has(node)) continue;
    const text = normalizeText(node.innerText || node.textContent);
    if (text.length < 12 || text.length > 5000) continue;
    if (node.children.length > 12 && !node.matches("article")) continue;
    processed.add(node);
    candidates.push({ node, text });
  }
  return candidates.slice(0, 50);
}

async function detectTexts(texts) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, threshold_profile: "balanced" })
  });
  if (!response.ok) {
    throw new Error(`Detector API returned ${response.status}`);
  }
  return response.json();
}

function buildBadge(result) {
  const badge = document.createElement("div");
  badge.className = "toxic-detector-badge";
  badge.textContent = `${result.action.toUpperCase()} | ${result.highest_label} ${(result.highest_score * 100).toFixed(0)}%`;
  return badge;
}

function applyReview(node, result) {
  node.classList.add("toxic-detector-review");
  node.dataset.toxicDetectorAction = result.action;
  node.prepend(buildBadge(result));
}

function applyBlock(node, result) {
  const wrapper = document.createElement("div");
  wrapper.className = "toxic-detector-wrapper";

  const originalParent = node.parentNode;
  if (!originalParent) return;

  originalParent.insertBefore(wrapper, node);
  wrapper.appendChild(node);
  node.classList.add("toxic-detector-blurred");

  const overlay = document.createElement("div");
  overlay.className = "toxic-detector-overlay";
  overlay.innerHTML = `
    <strong>Hidden high-risk comment</strong>
    <span>${result.highest_label} ${(result.highest_score * 100).toFixed(0)}%</span>
    <button type="button">Show anyway</button>
  `;
  overlay.querySelector("button").addEventListener("click", () => {
    node.classList.remove("toxic-detector-blurred");
    overlay.remove();
  });
  wrapper.appendChild(overlay);
}

function applyResult(candidate, result) {
  if (!result.flagged || result.action === "allow") return;
  if (result.action === "block") {
    applyBlock(candidate.node, result);
    return;
  }
  applyReview(candidate.node, result);
}

async function scanPage() {
  const candidates = collectCandidates();
  if (!candidates.length) return;

  try {
    const payload = await detectTexts(candidates.map((item) => item.text));
    payload.results.forEach((result, index) => {
      const candidate = candidates[index];
      if (candidate) applyResult(candidate, result);
    });
  } catch (error) {
    console.debug("Toxic detector unavailable:", error.message);
  }
}

function scheduleScan() {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scanPage, 700);
}

scheduleScan();
const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true });
