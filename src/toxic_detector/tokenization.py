from src.toxic_detector.config import DEFAULT_HEAD_TOKENS, DEFAULT_MAX_LENGTH, DEFAULT_TAIL_TOKENS


def encode_head_tail(
    tokenizer,
    text: str,
    max_length: int = DEFAULT_MAX_LENGTH,
    head_tokens: int = DEFAULT_HEAD_TOKENS,
    tail_tokens: int = DEFAULT_TAIL_TOKENS,
) -> dict[str, list[int]]:
    token_ids = tokenizer.encode(text, add_special_tokens=False)
    available = max_length - tokenizer.num_special_tokens_to_add(pair=False)
    if len(token_ids) > available:
        tail = min(tail_tokens, available)
        head = min(head_tokens, available - tail)
        if head + tail < available:
            head = available - tail
        token_ids = token_ids[:head] + token_ids[-tail:]

    truncated_text = tokenizer.decode(
        token_ids,
        clean_up_tokenization_spaces=False,
    )
    encoded = tokenizer(
        truncated_text,
        max_length=max_length,
        padding="max_length",
        truncation=True,
        return_attention_mask=True,
    )
    return {
        "input_ids": encoded["input_ids"],
        "attention_mask": encoded["attention_mask"],
    }
