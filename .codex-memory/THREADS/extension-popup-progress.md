## 2026-06-19 00:41 中国标准时间 - Added popup scan progress and non-blocking status

Actor: codex
Thread: extension-popup-progress
Purpose: work

Summary:
- Added popup scan progress and non-blocking status

Details:
  Changed the MV3 extension status flow so opening the popup no longer waits for offscreen model status or ONNX initialization. Background now keeps a cached runtime progress object and exposes `toxicShield:getQuickStatus`; full status also returns cached state instead of creating the offscreen document. Offscreen inference reports model loading and batch stages without raw comment text. Content script reports `collecting_done`, `predicting`, and `scanned` counts. Popup now renders `Model`, `Scanner`, and `Progress` rows immediately from cached state, then polls lightweight status while slow model loading continues.

Files touched:
- extension/manifest.json
- extension/background.js
- extension/background_helpers.js
- extension/content.js
- extension/offscreen_inference.js
- extension/popup.html
- extension/popup.css
- extension/popup.js
- extension/README.md
- extension/tests/background_helpers.test.js
- extension/tests/background_source.test.js
- extension/tests/content_source.test.js
- extension/tests/offscreen_source.test.js

Tests:
- node --test extension/tests/*.test.js passed 40 tests
- node --check extension/supported_sites.js extension/background.js extension/content.js extension/popup.js extension/shared.js extension/tokenizer.js extension/background_helpers.js extension/site_adapters.js extension/offscreen_inference.js passed
- python -m unittest discover -s tests -v passed 8 tests
- scripts/verify_extension_model.py passed with max abs diff 0.000005
- git diff --check passed with only existing Windows LF-to-CRLF warnings

Risks:
- Chrome still needs the unpacked extension reloaded to pick up manifest version 0.3.1. Code can make popup rendering non-blocking after popup JS starts, but Chrome may still delay opening a popup if the browser itself is busy starting the extension process.

Next:
- Reload `C:\Users\ssema\Desktop\nlpga\extension` in Chrome or Edge, confirm version 0.3.1, refresh the social page, then open the popup during first scan to verify the progress rows update through model loading and batch inference.
