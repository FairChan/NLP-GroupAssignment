# 模型优化实验日志

日期：2026-06-16

## 当前最佳结论

当前单模型最佳仍然是原始 DistilBERT + ASL 配置：

- 模型目录：`artifacts/distilbert`
- 配置：`distilbert-base-uncased`, ASL `gamma_neg=4`, `lr=2e-5`, `epochs=3`
- 验证集：`macro_f1=0.726010`, `micro_f1=0.809305`, `hamming_loss=0.014299`

本轮实验说明：单纯降低学习率并增加 epoch 没有提升 Macro F1；继续微调 baseline 也出现轻微过拟合。下一轮更建议做长尾类别专项优化，而不是继续增加 epoch。

## 实验对比

| 实验 | 模型目录 | 关键配置 | 最佳 epoch | Macro F1 | Micro F1 | Hamming Loss | 结论 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| Baseline | `artifacts/distilbert` | ASL `gamma_neg=4`, `lr=2e-5`, `epochs=3` | 3 | 0.726010 | 0.809305 | 0.014299 | 当前最佳单模型 |
| 低学习率从头训练 | `artifacts/distilbert_lr1e5_e5` | ASL `gamma_neg=4`, `lr=1e-5`, `epochs=5` | 3 | 0.721370 | 0.810902 | 0.014059 | Micro 与 hamming 更好，但 Macro 下降 |
| Baseline 继续小步微调 | `artifacts/distilbert_cont_lr5e6_e2` | 从 baseline 继续，`lr=5e-6`, `epochs=2` | 2 | 0.722871 | 0.804072 | 0.014675 | 继续训练伤害整体性能 |
| 调低 ASL 负类聚焦 | `artifacts/distilbert_gn3_lr2e5_e3` | ASL `gamma_neg=3`, `lr=2e-5`, `epochs=3` | 3 | 0.725331 | 0.808369 | 0.014445 | 接近 baseline，提升 identity_hate |

## 各标签 F1

| 标签 | Baseline | lr=1e-5/e5 | continue lr=5e-6/e2 | gamma_neg=3 |
| --- | ---: | ---: | ---: | ---: |
| toxic | 0.851716 | 0.850219 | 0.846515 | 0.848689 |
| severe_toxic | 0.553488 | 0.557103 | 0.541568 | 0.555283 |
| obscene | 0.853349 | 0.855211 | 0.847182 | 0.851351 |
| threat | 0.673684 | 0.644068 | 0.679245 | 0.660194 |
| insult | 0.792593 | 0.788889 | 0.787584 | 0.791515 |
| identity_hate | 0.631229 | 0.632727 | 0.635135 | 0.644951 |

## 下一步建议

1. 保留 `artifacts/distilbert` 作为当前正式模型，不替换线上/API 默认模型。
2. 下一轮优先尝试“长尾专项”而不是继续加 epoch：
   - capped BCE：给 `pos_weight` 增加上限，例如 30 或 50，避免 `threat` 的 333 倍权重过猛。
   - per-label threshold profile：为插件场景单独设置偏保守阈值，减少误封正常评论。
   - small ensemble：报告中可以讨论按标签融合多个 checkpoint，但插件 v1 不建议默认启用，推理成本会升高。
3. 如果继续训练单模型，建议下一组实验为 `ASL gamma_neg=4.5` 或 capped BCE，而不是更小学习率。

## 本轮代码修复

`src/toxic_detector/tokenization.py` 已加入 `verbose=False`，用于关闭 Hugging Face tokenizer 在 head-tail 截断前对超长文本产生的长度 warning；对应单测已加入 `tests/test_tokenization.py`。
