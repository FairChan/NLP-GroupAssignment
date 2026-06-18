## 2026-06-16 17:51 中国标准时间 - Added active-tab injection fallback diagnostics

Actor: codex
Thread: extension-active-injection-fallback
Purpose: work

Summary:
- Added active-tab injection fallback diagnostics

Details:
  Real Chrome inspection found visible X candidates but no `data-toxic-shield-injected` marker on X or YouTube, meaning the current Chrome profile was not injecting the unpacked extension into supported hosts. Added version 0.2.4 with a popup-triggered `activeTab` + `scripting` fallback: when the popup cannot reach the content script, it asks background to inject `site_adapters.js`, `content.js`, and `styles.css` into supported social hosts only, then retries status. Injection failures now surface as explicit popup diagnostics instead of quiet zero counts. Made content and site adapter scripts idempotent so a popup-triggered reinjection cannot fail from duplicate top-level declarations.

Files touched:
- extension/manifest.json
- extension/background.js
- extension/content.js
- extension/site_adapters.js
- extension/popup.js
- extension/README.md
- extension/tests/background_source.test.js
- extension/tests/content_source.test.js
- extension/tests/offscreen_source.test.js

Tests:
- node --test extension/tests/*.test.js passed 27 tests
- node --check extension/background.js extension/content.js extension/popup.js extension/shared.js extension/tokenizer.js extension/background_helpers.js extension/site_adapters.js extension/offscreen_inference.js passed
- scripts/verify_extension_model.py passed with max abs diff 0.000005
- python -m unittest discover -s tests -v passed 7 tests

Risks:
- Chrome still must reload the unpacked extension to pick up manifest version 0.2.4 and the new `scripting` permission. Automation cannot operate `chrome://extensions`, and Computer Use failed to initialize in this session, so real Chrome post-reload verification remains manual.

Next:
- Reload `C:\Users\ssema\Desktop\nlpga\extension` in Chrome, confirm version 0.2.4 and allow site access for x.com/youtube.com, refresh the social tab, then open the popup once if the page still shows zero so it can run the active-tab injection diagnostic.
