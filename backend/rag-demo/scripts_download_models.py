"""Fetch ONNX weights at image build time (not committed to git).
Sources: Xenova/multilingual-e5-small, Xenova/distilbert-base-multilingual-cased-ner-hrl,
cross-encoder/ms-marco-TinyBERT-L2-v2 (ONNX export)."""
import os
import urllib.request

BASE = "https://huggingface.co"
TARGETS = [
    ("multilingual-e5-small", f"{BASE}/Xenova/multilingual-e5-small/resolve/main", ["onnx/model_quantized.onnx:model_int8.onnx", "tokenizer.json"]),
    ("distilbert-ner", f"{BASE}/Xenova/distilbert-base-multilingual-cased-ner-hrl/resolve/main", ["onnx/model_quantized.onnx:model_int8.onnx", "tokenizer.json"]),
    ("tinybert-rerank", f"{BASE}/Xenova/ms-marco-TinyBERT-L-2-v2/resolve/main", ["onnx/model_quantized.onnx:model_int8.onnx", "tokenizer.json"]),
]
root = os.environ.get("MODELS_DIR", "/models")
for name, base, files in TARGETS:
    d = os.path.join(root, name)
    os.makedirs(d, exist_ok=True)
    for f in files:
        src, _, dst = f.partition(":")
        dst = dst or os.path.basename(src)
        out = os.path.join(d, dst)
        if os.path.exists(out):
            continue
        print("fetch", name, dst, flush=True)
        urllib.request.urlretrieve(f"{base}/{src}", out)
print("models ready in", root)
