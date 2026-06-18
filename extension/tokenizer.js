const DEFAULT_MAX_LENGTH = 256;
const DEFAULT_HEAD_TOKENS = 200;
const DEFAULT_TAIL_TOKENS = 50;

function stripAccents(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isControl(char) {
  const code = char.charCodeAt(0);
  return (code <= 31 || code === 127) && !/\s/.test(char);
}

function isPunctuation(char) {
  const code = char.charCodeAt(0);
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

function cleanText(text) {
  let output = "";
  for (const char of String(text || "")) {
    if (char === "\u0000" || char === "\ufffd" || isControl(char)) continue;
    output += /\s/.test(char) ? " " : char;
  }
  return output.replace(/\s+/g, " ").trim();
}

function splitOnPunctuation(token) {
  const parts = [];
  let current = "";
  for (const char of token) {
    if (isPunctuation(char)) {
      if (current) parts.push(current);
      parts.push(char);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function basicTokenize(text) {
  return cleanText(stripAccents(String(text || "").toLowerCase()))
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(splitOnPunctuation);
}

function createWordPieceTokenizer(tokenizerJson, options = {}) {
  const vocab = tokenizerJson?.model?.vocab || {};
  const unkToken = tokenizerJson?.model?.unk_token || "[UNK]";
  const subwordPrefix = tokenizerJson?.model?.continuing_subword_prefix || "##";
  const maxCharsPerWord = tokenizerJson?.model?.max_input_chars_per_word || 100;
  const maxLength = Number(options.maxLength || DEFAULT_MAX_LENGTH);
  const headTokens = Number(options.headTokens || DEFAULT_HEAD_TOKENS);
  const tailTokens = Number(options.tailTokens || DEFAULT_TAIL_TOKENS);
  const padId = vocab["[PAD]"] ?? 0;
  const clsId = vocab["[CLS]"] ?? 101;
  const sepId = vocab["[SEP]"] ?? 102;
  const unkId = vocab[unkToken] ?? 100;

  function wordPiece(token) {
    if (token.length > maxCharsPerWord) return [unkId];
    const ids = [];
    let start = 0;
    while (start < token.length) {
      let end = token.length;
      let matched = null;
      while (start < end) {
        const piece = `${start > 0 ? subwordPrefix : ""}${token.slice(start, end)}`;
        if (Object.prototype.hasOwnProperty.call(vocab, piece)) {
          matched = piece;
          break;
        }
        end -= 1;
      }
      if (!matched) return [unkId];
      ids.push(vocab[matched]);
      start = end;
    }
    return ids;
  }

  function truncate(tokenIds) {
    const available = maxLength - 2;
    if (tokenIds.length <= available) return tokenIds;
    const headCount = Math.min(headTokens, available);
    const tailCount = Math.max(0, Math.min(tailTokens, available - headCount));
    if (headCount + tailCount < available) {
      return tokenIds.slice(0, available);
    }
    return tokenIds.slice(0, headCount).concat(tokenIds.slice(tokenIds.length - tailCount));
  }

  function encode(text) {
    const tokenIds = truncate(basicTokenize(text).flatMap(wordPiece));
    const inputIds = [clsId, ...tokenIds, sepId];
    const attentionMask = inputIds.map(() => 1);
    while (inputIds.length < maxLength) {
      inputIds.push(padId);
      attentionMask.push(0);
    }
    return { inputIds, attentionMask };
  }

  return {
    encode,
    encodeBatch(texts) {
      return texts.map(encode);
    },
  };
}

if (typeof module !== "undefined") {
  module.exports = { createWordPieceTokenizer, basicTokenize };
}

if (typeof globalThis !== "undefined") {
  globalThis.ToxicShieldTokenizer = { createWordPieceTokenizer, basicTokenize };
}
