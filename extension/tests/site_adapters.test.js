const test = require("node:test");
const assert = require("node:assert/strict");

const { getAdapterForHostname, collectCommentCandidates } = require("../site_adapters.js");

function element(text, attrs = {}) {
  return {
    innerText: text,
    textContent: text,
    children: attrs.children || [],
    dataset: {},
    matches(selector) {
      return Boolean(attrs.matches?.includes(selector));
    },
    closest(selector) {
      if (attrs.closest?.includes(selector)) return {};
      return null;
    },
    querySelector(selector) {
      return attrs.query?.[selector] || null;
    },
    querySelectorAll(selector) {
      return attrs.queryAll?.[selector] || [];
    },
    contains(other) {
      return Boolean(attrs.contains?.includes(other));
    },
  };
}

test("known social hostnames resolve to adapters", () => {
  assert.equal(getAdapterForHostname("www.youtube.com").id, "youtube");
  assert.equal(getAdapterForHostname("x.com").id, "x");
  assert.equal(getAdapterForHostname("old.reddit.com").id, "reddit");
  assert.equal(getAdapterForHostname("www.linkedin.com").id, "linkedin");
  assert.equal(getAdapterForHostname("bsky.app").id, "bluesky");
  assert.equal(getAdapterForHostname("www.twitch.tv").id, "twitch");
  assert.equal(getAdapterForHostname("www.bilibili.com").id, "bilibili");
  assert.equal(getAdapterForHostname("mastodon.social").id, "mastodon");
});

test("fallback collector ignores long article-like text", () => {
  const longText = "word ".repeat(900);
  const paragraph = element("You are stupid and I hate you.", { matches: ["p"] });
  const article = element(longText, { matches: ["article"] });
  const doc = {
    querySelectorAll(selector) {
      if (selector === "p") return [paragraph];
      if (selector === "article") return [article];
      return [];
    },
  };

  const candidates = collectCommentCandidates(doc, "unknown.example", new WeakSet());

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].text, "You are stupid and I hate you.");
});

test("collector does not mark nodes processed before prediction succeeds", () => {
  const comment = element("You are stupid and I hate you.", { matches: ["p"] });
  const doc = {
    querySelectorAll(selector) {
      return selector === "p" ? [comment] : [];
    },
  };
  const processed = new WeakSet();

  const first = collectCommentCandidates(doc, "unknown.example", processed);
  const second = collectCommentCandidates(doc, "unknown.example", processed);
  processed.add(comment);
  const third = collectCommentCandidates(doc, "unknown.example", processed);

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(third.length, 0);
});

test("social adapters collect common YouTube, X, and Reddit comment DOMs", () => {
  const youtubeComment = element("This music video is still wonderful after all these years.", {
    matches: ["#content-text"],
  });
  const xPost = element("This reply is awful and you are stupid.", {
    matches: ["article[data-testid='tweet']"],
  });
  const redditComment = element("I disagree with this take, but thanks for explaining it.", {
    matches: ["[data-testid='comment']"],
  });
  const docs = {
    "youtube.com": {
      querySelectorAll(selector) {
        return selector === "#content-text" ? [youtubeComment] : [];
      },
    },
    "x.com": {
      querySelectorAll(selector) {
        return selector === "article[data-testid='tweet']" ? [xPost] : [];
      },
    },
    "reddit.com": {
      querySelectorAll(selector) {
        return selector === "[data-testid='comment']" ? [redditComment] : [];
      },
    },
  };

  assert.equal(collectCommentCandidates(docs["youtube.com"], "youtube.com", new WeakSet()).length, 1);
  assert.equal(collectCommentCandidates(docs["x.com"], "x.com", new WeakSet()).length, 1);
  assert.equal(collectCommentCandidates(docs["reddit.com"], "reddit.com", new WeakSet()).length, 1);
});

test("collector prefers specific child comment nodes over broad parent containers", () => {
  const tweetText = element("You are stupid and I hate you.", {
    matches: ["[data-testid='tweetText']"],
  });
  const tweetArticle = element("You are stupid and I hate you.", {
    matches: ["article[data-testid='tweet']"],
    contains: [tweetText],
  });
  const doc = {
    querySelectorAll(selector) {
      if (selector === "article[data-testid='tweet']") return [tweetArticle];
      if (selector === "[data-testid='tweetText']") return [tweetText];
      return [];
    },
  };

  const candidates = collectCommentCandidates(doc, "x.com", new WeakSet());

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].node, tweetText);
});

test("expanded adapters collect public comment DOMs from mainstream social platforms", () => {
  const samples = [
    ["linkedin.com", ".comments-comment-item", "This public LinkedIn reply is thoughtful and detailed."],
    ["bsky.app", "[data-testid='postText']", "This Bluesky post reply is visible in the public thread."],
    ["twitch.tv", "[data-a-target='chat-line-message']", "This Twitch live chat message should be scanned."],
    ["tumblr.com", "[data-testid='post-content']", "This Tumblr reblog note contains public discussion text."],
    ["pinterest.com", "[data-test-id='comment']", "This Pinterest comment talks about the design idea."],
    ["quora.com", ".q-box.qu-comment", "This Quora comment gives a public answer clarification."],
    ["medium.com", "article", "This Medium response is civil and useful for the author."],
    ["stackoverflow.com", ".comment-copy", "This Stack Overflow comment asks for a reproducible example."],
    ["bilibili.com", ".reply-content", "This Bilibili reply includes an English public comment."],
    ["weibo.com", ".woo-box-flex .detail_wbtext", "This Weibo public comment includes English discussion text."],
    ["zhihu.com", ".CommentContent", "This Zhihu public comment includes English feedback text."],
    ["xiaohongshu.com", ".comment-item", "This Xiaohongshu public note comment includes English text."],
    ["mastodon.social", ".status__content", "This Mastodon public reply should be scanned locally."],
  ];

  for (const [hostname, selector, text] of samples) {
    const comment = element(text, { matches: [selector] });
    const doc = {
      querySelectorAll(query) {
        return query === selector ? [comment] : [];
      },
    };

    const candidates = collectCommentCandidates(doc, hostname, new WeakSet());

    assert.equal(candidates.length, 1, `${hostname} should produce one candidate`);
    assert.equal(candidates[0].text, text);
  }
});

test("expanded adapters keep public scanner away from private messaging hosts", () => {
  assert.equal(getAdapterForHostname("discord.com").id, "fallback");
  assert.equal(getAdapterForHostname("messenger.com").id, "fallback");
  assert.equal(getAdapterForHostname("outlook.live.com").id, "fallback");
});

test("collector excludes controls, ads, navigation, and editor surfaces", () => {
  const publicComment = element("This public reply should still be scanned by the extension.", {
    matches: [".comments-comment-item"],
  });
  const buttonText = element("Open more options for this comment", {
    matches: [".comments-comment-item"],
    closest: ["button"],
  });
  const sponsoredText = element("Sponsored public looking text that should not be scanned.", {
    matches: [".comments-comment-item"],
    closest: ["[data-ad]", "[aria-label*='Sponsored' i]"],
  });
  const navText = element("Home notifications profile settings should not be scanned.", {
    matches: [".comments-comment-item"],
    closest: ["nav, header, footer, aside, [role='navigation'], [role='banner']"],
  });
  const editorText = element("Typed draft text should not be scanned by the extension.", {
    matches: [".comments-comment-item"],
    closest: ["textarea, input, [contenteditable='true']"],
  });
  const doc = {
    querySelectorAll(selector) {
      return selector === ".comments-comment-item"
        ? [publicComment, buttonText, sponsoredText, navText, editorText]
        : [];
    },
  };

  const candidates = collectCommentCandidates(doc, "linkedin.com", new WeakSet());

  assert.deepEqual(candidates.map((candidate) => candidate.text), [publicComment.textContent]);
});
