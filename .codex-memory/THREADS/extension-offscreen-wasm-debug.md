# Thread Memory: extension-offscreen-wasm-debug


## 2026-06-16 14:59 中国标准时间 - Moved offline extension inference into offscreen document

Actor: codex
Thread: extension-offscreen-wasm-debug
Purpose: work

Summary:
- Moved offline extension inference into offscreen document

Details:
  Fixed the offline toxic-comment extension runtime path after Chrome popup showed ONNX Runtime Web WASM initWasm backend failure. The content script was already finding candidates, so the root cause was model inference running inside the MV3 service worker. Replaced the service worker model runtime with an offscreen document proxy, added offscreen inference page and script, hardened runtime message handling so offscreen only responds to its own messages, added creation/message retry fallbacks, and updated docs/tests. Chrome automation could not open chrome://extensions due Browser Use URL policy, so the unpacked extension still needs manual Reload in Chrome.

Files touched:
- extension/background.js
- extension/offscreen.html
- extension/offscreen_inference.js
- extension/manifest.json
- extension/README.md
- extension/tests/background_source.test.js
- extension/tests/offscreen_source.test.js

Tests:
- node --test extension/tests/*.test.js passed 23 tests; node --check extension/background.js extension/content.js extension/popup.js extension/shared.js extension/tokenizer.js extension/background_helpers.js extension/site_adapters.js extension/offscreen_inference.js passed; scripts/verify_extension_model.py passed with max abs diff 0.000005; python -m unittest discover -s tests -v passed 7 tests; extension package static check passed

Risks:
- Manual Chrome reload and real social-site smoke test still required because chrome://extensions is blocked by browser automation policy. If a browser still reports WASM backend failure after reload, inspect the offscreen document console and possibly add non-threaded ORT wasm assets.

Next:
- In Chrome or Edge, reload the unpacked extension at C:\Users\ssema\Desktop\nlpga\extension, refresh the X/YouTube/Reddit page, then verify popup no longer shows initWasm and high-risk English comments blur.
