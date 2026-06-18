# Thread Memory: extension-zero-count-implementation


## 2026-06-16 10:00 中国标准时间 - Fixed extension zero-count scanning and added diagnostics

Actor: codex
Thread: extension-zero-count-implementation
Purpose: work

Summary:
- Fixed extension zero-count scanning and added diagnostics

Details:
  Root cause was that the MV3 worker failed to start because shared.js declared LABELS in the same importScripts scope as the worker bundle, and the content script also hid failures by silently treating missing candidates or prediction errors as zero. I converted shared.js into a globalThis-safe namespace module, moved candidate processed marking until after successful prediction, added scan/status reports from content.js to background.js, and upgraded popup.js to surface unsupported-page, no-candidate, adapter-missing, prediction-error, and ready states. I also added regression tests for combined worker scope parsing, scan diagnostics, and social adapter extraction. The browser extension still needs a manual Chrome reload/unpacked reload to pick up the new code, but the code paths and tests are now green.

Files touched:
- extension/shared.js
- extension/site_adapters.js
- extension/background_helpers.js
- extension/background.js
- extension/content.js
- extension/popup.html
- extension/popup.css
- extension/popup.js
- extension/manifest.json
- extension/tests/background_source.test.js
- extension/tests/site_adapters.test.js
- extension/tests/background_helpers.test.js
- extension/tests/content_source.test.js

Tests:
- node --test extension/tests/*.test.js passed 18 tests; node --check extension/background.js extension/content.js extension/popup.js extension/shared.js extension/background_helpers.js extension/site_adapters.js passed; scripts/verify_extension_model.py --model-dir artifacts/distilbert --onnx-path extension/model/model.onnx passed; python -m unittest discover -s tests -v passed 7 tests

Risks:
- The currently loaded Chrome unpacked extension may still be the old worker until the user reloads the extension and the page. Real social-site smoke tests still need a manual browser check after reload because the Browser Use surface cannot open chrome://extensions here.

Next:
- Reload the unpacked extension in Chrome/Edge, open a supported social page, and confirm the popup shows a supported-page status plus a nonzero candidate count when comments are visible.
