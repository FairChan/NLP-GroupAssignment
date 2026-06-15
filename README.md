# 有害评论与网络暴力检测系统

这是一个英文有害评论多标签检测项目，包含：

- `TF-IDF + Logistic Regression` baseline
- `DistilBERT + Asymmetric Loss` 深度学习模型
- FastAPI 本地推理服务
- Chrome/Edge Manifest V3 浏览器插件

## 1. 创建训练环境

当前机器默认 Python 是 3.13，不建议直接用于训练。请使用 conda 创建 Python 3.11 环境：

```powershell
conda create -n toxic-nlp python=3.11 -y
conda activate toxic-nlp
```

安装 PyTorch CUDA 版本：

```powershell
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

安装项目依赖：

```powershell
pip install -r requirements.txt
```

检查 GPU：

```powershell
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

## 2. 下载 Kaggle 数据

1. 在 Kaggle 账户中创建 API token。
2. 将 `kaggle.json` 放到：

```text
C:\Users\ssema\.kaggle\kaggle.json
```

3. 下载并解压数据：

```powershell
.\scripts\download_kaggle.ps1
```

确认存在：

```text
data/raw/train.csv
```

## 3. 训练模型

先训练 baseline：

```powershell
python -m src.toxic_detector.train_baseline --data-path data/raw/train.csv --output-dir artifacts/baseline
```

再训练 DistilBERT：

```powershell
python -m src.toxic_detector.train_transformer --data-path data/raw/train.csv --output-dir artifacts/distilbert
```

训练完成后，`artifacts/distilbert` 中应包含：

- `config.json`
- `model.safetensors` 或 `pytorch_model.bin`
- `tokenizer.json` / tokenizer 配置文件
- `thresholds.json`
- `metrics.json`
- `training_config.json`

也可以一次运行：

```powershell
.\scripts\train_all.ps1
```

## 4. 启动本地推理 API

```powershell
.\scripts\start_api.ps1 -ModelDir artifacts/distilbert -Port 8000
```

健康检查：

```powershell
curl http://127.0.0.1:8000/health
```

预测测试：

```powershell
curl -X POST http://127.0.0.1:8000/predict `
  -H "Content-Type: application/json" `
  -d '{"texts":["You are stupid and I hate you."],"threshold_profile":"balanced"}'
```

## 5. 加载浏览器插件

1. 打开 Chrome 或 Edge 的扩展管理页。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择本项目的 `extension` 文件夹。
5. 保持 FastAPI 服务运行，然后打开包含英文评论的网页。

插件行为：

- `allow`：不改变网页。
- `review`：给评论加黄色提示。
- `block`：默认模糊并显示 `Show anyway` 按钮。

## 6. 评估指标

训练脚本会生成：

- 每标签 Precision / Recall / F1 / ROC-AUC
- Macro F1
- Micro F1
- Hamming Loss
- 每标签最佳阈值

重点关注 `threat` 和 `identity_hate` 的召回率，以及含身份词但无攻击性的正常句子是否被误判。

## 7. 常见问题

如果 `/health` 显示 `model_unavailable`，通常是因为还没训练模型，或者 `TOXIC_MODEL_DIR` 指向错误目录。

如果显存不足，将 DistilBERT 训练命令改为：

```powershell
python -m src.toxic_detector.train_transformer --batch-size 4 --gradient-accumulation-steps 4
```

如果只想 CPU 跑通流程：

```powershell
python -m src.toxic_detector.train_transformer --cpu --batch-size 2 --eval-batch-size 4 --epochs 1
```
