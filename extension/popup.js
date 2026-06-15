const statusEl = document.getElementById("status");
const refreshButton = document.getElementById("refresh");

async function refreshStatus() {
  statusEl.textContent = "Checking local API...";
  try {
    const response = await fetch("http://127.0.0.1:8000/health");
    const payload = await response.json();
    statusEl.textContent = payload.model_loaded
      ? `Model loaded on ${payload.device || "unknown device"}`
      : "API reachable, model not loaded";
  } catch (error) {
    statusEl.textContent = "Local API is not running";
  }
}

refreshButton.addEventListener("click", refreshStatus);
refreshStatus();
