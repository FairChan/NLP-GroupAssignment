const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SUPPORTED_SITE_HOSTS,
  SUPPORTED_SITE_MATCHES,
  isSupportedHostname,
} = require("../supported_sites.js");

test("supported site registry includes expanded public social platforms", () => {
  [
    "linkedin.com",
    "bsky.app",
    "twitch.tv",
    "tumblr.com",
    "pinterest.com",
    "quora.com",
    "medium.com",
    "stackoverflow.com",
    "bilibili.com",
    "weibo.com",
    "zhihu.com",
    "xiaohongshu.com",
    "mastodon.social",
  ].forEach((host) => {
    assert.ok(SUPPORTED_SITE_HOSTS.includes(host), `${host} missing from supported host registry`);
    assert.ok(isSupportedHostname(host), `${host} should resolve as supported`);
    assert.ok(isSupportedHostname(`www.${host}`), `www.${host} should resolve as supported`);
  });
});

test("manifest host permissions and content matches mirror supported site registry", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  const contentMatches = manifest.content_scripts.flatMap((script) => script.matches || []);

  assert.deepEqual(new Set(manifest.host_permissions), new Set(SUPPORTED_SITE_MATCHES));
  assert.deepEqual(new Set(contentMatches), new Set(SUPPORTED_SITE_MATCHES));
  assert.ok(!SUPPORTED_SITE_MATCHES.includes("<all_urls>"));
});

test("extension scripts use the supported site registry instead of local host lists", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8")
    + fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));

  assert.match(background, /supported_sites\.js/);
  assert.match(popup, /supported_sites\.js/);
  assert.ok(manifest.content_scripts[0].js.includes("supported_sites.js"));
});
