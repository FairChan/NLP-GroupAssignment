(() => {
const existingSupportedSites = globalThis.ToxicShieldSupportedSites;
if (existingSupportedSites) {
  if (typeof module !== "undefined") {
    module.exports = existingSupportedSites;
  }
  return;
}

const SUPPORTED_SITE_DEFINITIONS = [
  { id: "youtube", label: "YouTube", hosts: ["youtube.com"] },
  { id: "x", label: "X / Twitter", hosts: ["x.com", "twitter.com"] },
  { id: "reddit", label: "Reddit", hosts: ["reddit.com"] },
  { id: "facebook", label: "Facebook", hosts: ["facebook.com"] },
  { id: "instagram", label: "Instagram", hosts: ["instagram.com"] },
  { id: "threads", label: "Threads", hosts: ["threads.net"] },
  { id: "tiktok", label: "TikTok", hosts: ["tiktok.com"] },
  { id: "linkedin", label: "LinkedIn", hosts: ["linkedin.com"] },
  { id: "bluesky", label: "Bluesky", hosts: ["bsky.app"] },
  { id: "twitch", label: "Twitch", hosts: ["twitch.tv"] },
  { id: "tumblr", label: "Tumblr", hosts: ["tumblr.com"] },
  { id: "pinterest", label: "Pinterest", hosts: ["pinterest.com"] },
  { id: "quora", label: "Quora", hosts: ["quora.com"] },
  { id: "medium", label: "Medium", hosts: ["medium.com"] },
  {
    id: "stack_exchange",
    label: "Stack Exchange",
    hosts: ["stackoverflow.com", "serverfault.com", "superuser.com", "askubuntu.com", "stackexchange.com"],
  },
  { id: "bilibili", label: "Bilibili", hosts: ["bilibili.com"] },
  { id: "weibo", label: "Weibo", hosts: ["weibo.com", "weibo.cn"] },
  { id: "zhihu", label: "Zhihu", hosts: ["zhihu.com"] },
  { id: "xiaohongshu", label: "Xiaohongshu", hosts: ["xiaohongshu.com"] },
  { id: "mastodon", label: "Mastodon", hosts: ["mastodon.social", "mas.to", "mstdn.social"] },
];

const SUPPORTED_SITE_HOSTS = Array.from(new Set(SUPPORTED_SITE_DEFINITIONS.flatMap((site) => site.hosts)));
const SUPPORTED_SITE_MATCHES = SUPPORTED_SITE_HOSTS.flatMap((host) => [`*://${host}/*`, `*://*.${host}/*`]);

function normalizeHostname(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

function isSupportedHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return SUPPORTED_SITE_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

function isSupportedUrl(url) {
  try {
    const parsed = new URL(url || "");
    return ["http:", "https:"].includes(parsed.protocol) && isSupportedHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function hostsForSite(siteId) {
  const site = SUPPORTED_SITE_DEFINITIONS.find((candidate) => candidate.id === siteId);
  return site ? site.hosts : [];
}

const supportedSitesApi = {
  SUPPORTED_SITE_DEFINITIONS,
  SUPPORTED_SITE_HOSTS,
  SUPPORTED_SITE_MATCHES,
  normalizeHostname,
  isSupportedHostname,
  isSupportedUrl,
  hostsForSite,
};

if (typeof module !== "undefined") {
  module.exports = supportedSitesApi;
}

if (typeof globalThis !== "undefined") {
  globalThis.ToxicShieldSupportedSites = supportedSitesApi;
}
})();
