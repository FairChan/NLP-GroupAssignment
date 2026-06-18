# Thread: extension-runtime-smoke-fix

## 2026-06-16 16:43 中国标准时间 - Fixed extension runtime smoke path and diagnostics

Actor: codex
Purpose: work
Branch: main

Summary:
- Fixed extension runtime smoke path and diagnostics

Details:
  Verified the offscreen ONNX path in a real temporary Edge extension environment, found the local fixture was not exercising the X adapter because it used `data-testid="comment"` while the x.com adapter scans `article[data-testid="tweet"]` and `[data-testid="tweetText"]`, then updated the fixture to X-like DOM. Added an invisible content-script injection marker on `<html>` (`data-toxic-shield-injected`) so a live page can distinguish "extension not injected" from "injected but prediction failed". Added candidate de-duplication so parent tweet containers and child tweet text nodes are not both processed, and changed post-scan empty status from misleading `no_candidates` to `idle`.

Files touched:
- extension/content.js
- extension/site_adapters.js
- extension/popup.js
- extension/manifest.json
- extension/README.md
- extension/fixtures/social_comments.html
- extension/tests/content_source.test.js
- extension/tests/site_adapters.test.js

Tests:
- node --test extension/tests/*.test.js passed 24 tests
- node --check extension/background.js extension/content.js extension/popup.js extension/shared.js extension/tokenizer.js extension/background_helpers.js extension/site_adapters.js extension/offscreen_inference.js passed
- scripts/verify_extension_model.py passed with max abs diff 0.000005
- python -m unittest discover -s tests -v passed 7 tests
- Temporary Edge extension smoke test passed: injected=0.2.3, modelState=ready/wasm, scanned=4, blocked=2, overlayCount=2, blurredCount=2

Risks:
- The user's already-open Chrome profile still needs the unpacked extension reloaded manually because automation cannot operate chrome://extensions here. If the live page lacks `data-toxic-shield-injected="0.2.3"` after refresh, Chrome did not inject the current extension into that tab, usually due to old loaded path/version or site access.

Next:
- In Chrome, reload the unpacked extension from C:\Users\ssema\Desktop\nlpga\extension, confirm version 0.2.3, allow site access for x.com/twitter.com, then refresh the social page and verify high-risk comments blur.
