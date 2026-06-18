# Offline Toxic Comment Shield

Chrome/Edge Manifest V3 extension for offline English toxic-comment moderation.

## What Runs Locally

- `background.js` keeps site settings, popup status, and tab statistics.
- `offscreen.html` loads `model/model.onnx` with local ONNX Runtime Web assets in `vendor/onnxruntime-web/`.
- `offscreen_inference.js` performs local model loading and batch prediction in an extension document context.
- `tokenizer.js` performs DistilBERT-style lowercase WordPiece tokenization.
- `content.js` scans supported social-media comment DOMs and asks the background worker for predictions.
- No comment text is sent to localhost or any remote server.

## Load In Chrome Or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this folder: `C:\Users\ssema\Desktop\nlpga\extension`.
5. If this extension was already loaded, click **Reload** on the extension card.
6. Refresh the social-media page so the content script and background worker use the new version.
7. Open a supported public social-media page: YouTube, X/Twitter, Reddit, Facebook, Instagram, Threads, TikTok, LinkedIn, Bluesky, Twitch, Tumblr, Pinterest, Quora, Medium, Stack Exchange, Bilibili, Weibo, Zhihu, Xiaohongshu, or common Mastodon instances.

The model loads in a hidden extension document on the first scan. The first scan can take several seconds because `model.onnx` is about 268 MB.

## Troubleshooting A Page That Stays At Zero

After reloading the unpacked extension, refresh the social-media tab. On a supported page, the content script writes a hidden diagnostic marker to the page root:

```text
data-toxic-shield-injected="0.3.1"
```

If that marker is missing, open the extension popup on the social-media tab. Version `0.3.1` retries content-script injection on supported tab load/activation and from the popup, then reports `markerPresent`, `injectedVersion`, and any injection error in the diagnostic panel. If the popup reports an injection failure, check that the unpacked extension path is exactly `C:\Users\ssema\Desktop\nlpga\extension`, the version is `0.3.1`, and site access is allowed for the current host, then refresh the page again.

If the marker exists but comments are still not hidden, open the popup and check the progress panel. The popup renders cached status first, then updates `Model`, `Scanner`, and `Progress` while the hidden offscreen page loads tokenizer/model assets or runs ONNX batches. `injected`, `scheduled`, `collecting_done`, and `predicting` are transient first-scan states; wait for them to settle before treating the count as final. `prediction_error` or `Model error` points to the offscreen ONNX runtime path; `no_candidates` means the page needs to be scrolled to a visible comment area or the site adapter needs updating.

## Quick Fixture

For a small local smoke test, open:

```text
C:\Users\ssema\Desktop\nlpga\extension\fixtures\social_comments.html
```

Chrome extensions normally do not run content scripts on `file://` unless **Allow access to file URLs** is enabled for the extension. Real target social sites do not need that setting.

## Rebuild Model Assets

From PowerShell:

```powershell
$env:PYTHONIOENCODING='utf-8'
$env:PYTHONUTF8='1'
& 'C:\Users\ssema\.conda\envs\toxic-nlp\python.exe' scripts\export_extension_model.py --model-dir artifacts\distilbert --output-dir extension\model
& 'C:\Users\ssema\.conda\envs\toxic-nlp\python.exe' scripts\verify_extension_model.py --model-dir artifacts\distilbert --onnx-path extension\model\model.onnx
```
