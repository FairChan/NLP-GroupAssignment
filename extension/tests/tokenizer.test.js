const test = require("node:test");
const assert = require("node:assert/strict");

const { createWordPieceTokenizer } = require("../tokenizer.js");

const tokenizerJson = {
  model: {
    unk_token: "[UNK]",
    continuing_subword_prefix: "##",
    max_input_chars_per_word: 100,
    vocab: {
      "[PAD]": 0,
      "[UNK]": 100,
      "[CLS]": 101,
      "[SEP]": 102,
      hello: 7592,
      world: 2088,
      toxic: 11704,
      "##ity": 3012,
      "!": 999,
    },
  },
};

test("wordpiece tokenizer lowercases, splits punctuation, and pads", () => {
  const tokenizer = createWordPieceTokenizer(tokenizerJson, { maxLength: 8 });

  const encoded = tokenizer.encodeBatch(["Hello toxicity!"])[0];

  assert.deepEqual(encoded.inputIds, [101, 7592, 11704, 3012, 999, 102, 0, 0]);
  assert.deepEqual(encoded.attentionMask, [1, 1, 1, 1, 1, 1, 0, 0]);
});

test("wordpiece tokenizer applies head-tail truncation", () => {
  const tokenizer = createWordPieceTokenizer(tokenizerJson, {
    maxLength: 6,
    headTokens: 2,
    tailTokens: 1,
  });

  const encoded = tokenizer.encodeBatch(["hello world toxic world"])[0];

  assert.deepEqual(encoded.inputIds, [101, 7592, 2088, 11704, 2088, 102]);
  assert.deepEqual(encoded.attentionMask, [1, 1, 1, 1, 1, 1]);
});
