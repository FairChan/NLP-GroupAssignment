import unittest

from src.toxic_detector.tokenization import encode_head_tail


class MinimalTokenizer:
    def __init__(self):
        self.last_encode_verbose = None

    def encode(self, text, add_special_tokens=False):
        return [int(part) for part in text.split()]

    def num_special_tokens_to_add(self, pair=False):
        return 2

    def decode(self, token_ids, clean_up_tokenization_spaces=False):
        return " ".join(str(token_id) for token_id in token_ids)

    def __call__(self, text, max_length, padding, truncation, return_attention_mask):
        token_ids = [101] + [int(part) for part in text.split()] + [102]
        token_ids = token_ids[:max_length]
        attention_mask = [1] * len(token_ids)
        while len(token_ids) < max_length:
            token_ids.append(0)
            attention_mask.append(0)
        return {"input_ids": token_ids, "attention_mask": attention_mask}


class TokenizationTests(unittest.TestCase):
    def test_encode_head_tail_works_without_prepare_for_model(self):
        encoded = encode_head_tail(
            MinimalTokenizer(),
            "1 2 3 4 5 6 7 8",
            max_length=6,
            head_tokens=2,
            tail_tokens=2,
        )

        self.assertEqual(encoded["input_ids"], [101, 1, 2, 7, 8, 102])
        self.assertEqual(encoded["attention_mask"], [1, 1, 1, 1, 1, 1])

    def test_encode_head_tail_disables_tokenizer_length_warning(self):
        class VerboseAwareTokenizer(MinimalTokenizer):
            def encode(self, text, add_special_tokens=False, **kwargs):
                self.last_encode_verbose = kwargs.get("verbose")
                return super().encode(text, add_special_tokens=add_special_tokens)

        tokenizer = VerboseAwareTokenizer()

        encode_head_tail(tokenizer, "1 2 3 4 5 6 7 8", max_length=6)

        self.assertIs(tokenizer.last_encode_verbose, False)


if __name__ == "__main__":
    unittest.main()
