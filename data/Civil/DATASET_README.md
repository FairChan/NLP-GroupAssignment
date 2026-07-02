# NLP_Violence_CivilComments — 多标签有害评论数据集

从公开的 **Civil Comments / Jigsaw Unintended Bias in Toxicity Classification** 数据集中筛选并重整的英文有害评论语料库。文件结构与 YouTube、Google Play 两份数据包保持一致，采用同一组 Jigsaw 6 标签。

## 1. 数据集概览

| 项目 | 数值 |
|---|---|
| 样本数 | **8,000 条评论** |
| 总词数 | **418,016**（平均 52.25 词/条） |
| 语言 | 英文 |
| 数据来源 | Civil Comments（约 50 家英文新闻网站的公开评论，2015–2017） |
| 标签来源 | 人类众包标注的聚合比例，不是 LLM 生成标签 |
| 标签二值化 | `severe_toxic >= 0.3`；其余五标签 `>= 0.5` |
| 训练/验证/测试 | 5,600 / 1,200 / 1,200（70 / 15 / 15，分层，seed=42） |
| 许可 | **CC0-1.0** |

## 2. 最主要来源

- TensorFlow Datasets 官方目录：https://www.tensorflow.org/datasets/catalog/civil_comments
- Google 官方 Hugging Face 镜像：https://huggingface.co/datasets/google/civil_comments
- 本包使用的公开 Parquet 分片：`default/train/0000.parquet`（902,437 行候选）
- 原始项目：Jigsaw Unintended Bias in Toxicity Classification / Civil Comments

TensorFlow 官方说明指出，评论来自 Civil Comments 平台存档，覆盖全球约 50 家英文新闻网站；Jigsaw 为评论补充了毒性与身份攻击等众包标签。数据及评论文本以 CC0 发布。

## 3. 文件清单

```text
submission/
├── DATASET_README.md
├── dataset_labeled.csv
├── dataset_stats.json
├── train.csv
├── val.csv
├── test.csv
├── split_stats.json
├── iaa_report.json
└── cross_model_labels.csv
```

## 4. 主 CSV 字段

| 列名 | 说明 |
|---|---|
| `id` | 由清洗后文本 SHA-256 生成的稳定匿名 ID |
| `source` | 固定为 `civil_comments` |
| `text` | 清洗后的评论文本 |
| `word_count` | 词数 |
| `bucket` | `neutral` / `profanity` / `insult` / `threat` / `identity` |
| `toxic` | 毒性标签，0/1 |
| `severe_toxic` | 严重毒性标签，0/1；源字段 `severe_toxicity` |
| `obscene` | 粗俗/淫秽标签，0/1 |
| `threat` | 威胁标签，0/1 |
| `insult` | 侮辱标签，0/1 |
| `identity_hate` | 身份攻击标签，0/1；源字段 `identity_attack` |
| `llm_model` | 为兼容原格式而保留；固定为 `civil-comments-human-crowd` |
| `cost_usd` | 固定为 0；公开数据没有逐条 API 标注费用 |

## 5. 标签分布

| 标签 | 正样本数 | 比例 |
|---|---:|---:|
| toxic | 3421 | 42.76% |
| severe_toxic | 93 | 1.16% |
| obscene | 842 | 10.53% |
| threat | 209 | 2.61% |
| insult | 1806 | 22.57% |
| identity_hate | 400 | 5.0% |

## 6. 去重与“不重复”核验

- 新数据内部共有 **8,000 个唯一 ID、8,000 条唯一规范化文本**。
- 对 YouTube 与 Google Play 两包共 16,000 行进行文本比对。
- 比对规范：Unicode NFKC、转小写、去标点、合并空白后计算 SHA-256。
- 新包与两份参考包的规范化文本交集：**0 条**。
- 数据来自 Civil Comments 新闻站点评论平台，不来自 YouTube 或 Google Play。

这里的“不重复”指可验证的文本级不重复；无法证明不同作者从未写过语义相似的改写句。

## 7. 抽样方法

为避免纯随机抽样造成 `threat`、`identity_hate` 等标签几乎没有正样本，先按二值标签形成互斥抽样层，再固定配额抽取：`neutral 4520 / insult 1200 / obscene 800 / toxic_only 800 / identity 400 / threat 200 / severe 80`。`severe_toxicity` 是极稀有聚合分数：统一使用 0.5 时，本分片 902,437 行中只有 2 行达标，因此该标签单独使用 0.3 阈值；其余五标签保持 0.5。最终 `bucket` 记录实际抽样层，并使用 `identity > threat > insult > profanity > neutral` 命名体系。

切分前先完成清洗和去重，再按 `bucket + 6 标签组合` 分层，因此 train / val / test 之间不存在重复文本泄漏。

## 8. 质量审计说明

原始标签是多人标注后得到的 0–1 聚合比例。本包对 `severe_toxic` 使用 0.3、其余标签使用 0.5 阈值二值化，并在 `cross_model_labels.csv` 中保留 800 条分层审计样本及六个原始分数。

`iaa_report.json` 没有伪造“跨模型一致性”：公开镜像不提供逐个标注员的判断，因此不能合法重建 human-human Cohen's κ。该文件改为记录主阈值与更保守阈值（`severe_toxic: 0.3→0.5`，其余标签 `0.5→0.7`）的敏感性分析；其中的 κ 仅表示阈值稳定性，不是标注员一致性。

## 9. 伦理与局限

- 评论可能包含侮辱、仇恨、威胁或露骨措辞，仅供研究和教学。
- 聚合分数二值化会损失不确定性；需要概率标签时请使用审计文件中的原始分数或重新取得完整原始数据。
- 本包是平衡抽样子集，不代表 Civil Comments 的自然发生率。
- `id` 是为本包生成的匿名稳定 ID，并非原平台用户或评论 ID。
