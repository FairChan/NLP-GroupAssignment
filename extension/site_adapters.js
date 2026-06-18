(() => {
const existingAdapters = globalThis.ToxicShieldSiteAdapters;
if (existingAdapters) {
  if (typeof module !== "undefined") {
    module.exports = existingAdapters;
  }
  return;
}

let supportedSitesExports = {};
if (typeof require !== "undefined") {
  supportedSitesExports = require("./supported_sites.js");
} else if (typeof globalThis !== "undefined" && globalThis.ToxicShieldSupportedSites) {
  supportedSitesExports = globalThis.ToxicShieldSupportedSites;
}

const hostsForSiteRef = supportedSitesExports.hostsForSite || (() => []);

const FALLBACK_SELECTORS = [
  "[data-testid*='comment' i]",
  "[aria-label*='comment' i]",
  "[class*='comment' i]",
  "article",
  "p",
];

const DEFAULT_EXCLUDE_SELECTORS = [
  ".toxic-detector-wrapper",
  "textarea, input, [contenteditable='true']",
  "button",
  "[role='button']",
  "a[href]",
  "nav, header, footer, aside, [role='navigation'], [role='banner']",
  "[data-ad]",
  "[class*='ad-' i]",
  "[class*='sponsor' i]",
  "[aria-label*='Sponsored' i]",
  "[aria-label*='advertisement' i]",
];

const SITE_ADAPTERS = [
  {
    id: "youtube",
    hosts: hostsForSiteRef("youtube"),
    selectors: ["ytd-comment-thread-renderer", "#content-text"],
  },
  {
    id: "x",
    hosts: hostsForSiteRef("x"),
    selectors: ["article[data-testid='tweet']", "[data-testid='tweetText']"],
  },
  {
    id: "reddit",
    hosts: hostsForSiteRef("reddit"),
    selectors: ["[data-testid='comment']", "shreddit-comment", ".comment"],
  },
  {
    id: "facebook",
    hosts: hostsForSiteRef("facebook"),
    selectors: ["[aria-label*='Comment' i]", "[role='article']"],
  },
  {
    id: "instagram",
    hosts: hostsForSiteRef("instagram"),
    selectors: ["ul ul span", "[role='button'] + div span"],
  },
  {
    id: "threads",
    hosts: hostsForSiteRef("threads"),
    selectors: ["[role='article']", "article"],
  },
  {
    id: "tiktok",
    hosts: hostsForSiteRef("tiktok"),
    selectors: ["[data-e2e*='comment' i]", "[class*='comment' i]"],
  },
  {
    id: "linkedin",
    hosts: hostsForSiteRef("linkedin"),
    selectors: [".comments-comment-item", "[data-test-id*='comment' i]", "article"],
  },
  {
    id: "bluesky",
    hosts: hostsForSiteRef("bluesky"),
    selectors: ["[data-testid='postText']", "[data-testid*='reply' i]", "article"],
  },
  {
    id: "twitch",
    hosts: hostsForSiteRef("twitch"),
    selectors: ["[data-a-target='chat-line-message']", "[data-test-selector*='comment' i]"],
  },
  {
    id: "tumblr",
    hosts: hostsForSiteRef("tumblr"),
    selectors: ["[data-testid='post-content']", "[data-testid*='reply' i]", "article"],
  },
  {
    id: "pinterest",
    hosts: hostsForSiteRef("pinterest"),
    selectors: ["[data-test-id='comment']", "[data-test-id*='comment' i]"],
  },
  {
    id: "quora",
    hosts: hostsForSiteRef("quora"),
    selectors: [".q-box.qu-comment", "[class*='comment' i]", "div[role='article']"],
  },
  {
    id: "medium",
    hosts: hostsForSiteRef("medium"),
    selectors: ["article", "[data-testid*='response' i]", "[class*='response' i]"],
  },
  {
    id: "stack_exchange",
    hosts: hostsForSiteRef("stack_exchange"),
    selectors: [".comment-copy", ".answercell", ".question"],
  },
  {
    id: "bilibili",
    hosts: hostsForSiteRef("bilibili"),
    selectors: [".reply-content", ".comment-content", "[class*='reply' i]"],
  },
  {
    id: "weibo",
    hosts: hostsForSiteRef("weibo"),
    selectors: [".woo-box-flex .detail_wbtext", "[class*='comment' i]", "[node-type='feed_list_content']"],
  },
  {
    id: "zhihu",
    hosts: hostsForSiteRef("zhihu"),
    selectors: [".CommentContent", ".RichContent-inner", "[class*='comment' i]"],
  },
  {
    id: "xiaohongshu",
    hosts: hostsForSiteRef("xiaohongshu"),
    selectors: [".comment-item", ".note-text", "[class*='comment' i]"],
  },
  {
    id: "mastodon",
    hosts: hostsForSiteRef("mastodon"),
    selectors: [".status__content", "[data-testid='status']", "article"],
  },
];

function normalizeHostname(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

function getAdapterForHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return (
    SITE_ADAPTERS.find((adapter) =>
      adapter.hosts.some((host) => normalized === normalizeHostname(host) || normalized.endsWith(`.${normalizeHostname(host)}`)),
    ) || {
      id: "fallback",
      hosts: [],
      selectors: FALLBACK_SELECTORS,
    }
  );
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function visibleElement(element) {
  if (typeof HTMLElement !== "undefined" && !(element instanceof HTMLElement)) return false;
  if (DEFAULT_EXCLUDE_SELECTORS.some((selector) => element.closest?.(selector))) return false;
  if (typeof window !== "undefined" && window.getComputedStyle) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (element.offsetParent === null && style.position !== "fixed") return false;
  }
  return true;
}

function isProbablyCommentNode(element, text) {
  if (text.length < 12 || text.length > 1200) return false;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount > 220) return false;
  if (element.children?.length > 18 && !element.matches?.("article")) return false;
  if (DEFAULT_EXCLUDE_SELECTORS.some((selector) => element.closest?.(selector))) return false;
  return true;
}

function collectCommentCandidates(documentLike, hostname, processed) {
  const adapter = getAdapterForHostname(hostname);
  const selectors = adapter.selectors?.length ? adapter.selectors : FALLBACK_SELECTORS;
  const nodes = new Set();
  for (const selector of selectors) {
    documentLike.querySelectorAll(selector).forEach((node) => nodes.add(node));
  }

  const rawNodes = Array.from(nodes);
  const leafCandidateNodes = rawNodes.filter((node) => {
    if (typeof node.contains !== "function") return true;
    return !rawNodes.some((other) => other !== node && node.contains(other));
  });

  const candidates = [];
  const seenTexts = new Set();
  for (const node of leafCandidateNodes) {
    if (processed?.has(node)) continue;
    if (!visibleElement(node)) continue;
    const text = normalizeText(node.innerText || node.textContent);
    if (!isProbablyCommentNode(node, text)) continue;
    if (seenTexts.has(text)) continue;
    seenTexts.add(text);
    candidates.push({ node, text, adapterId: adapter.id });
  }
  return candidates.slice(0, 64);
}

const adapterApi = {
  SITE_ADAPTERS,
  getAdapterForHostname,
  collectCommentCandidates,
  normalizeText,
  isProbablyCommentNode,
};

if (typeof module !== "undefined") {
  module.exports = adapterApi;
}

if (typeof globalThis !== "undefined") {
  globalThis.ToxicShieldSiteAdapters = adapterApi;
}
})();
