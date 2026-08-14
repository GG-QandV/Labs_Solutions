"""Fetch ONNX weights at image build time (not committed to git).
Embedder: granite-embedding-97m-multilingual-r2 (int8 avx2, SELECTED) + e5-small (rollback).
Reranker: gte-multilingual-reranker-base (int8, SELECTED) + TinyBERT-L2 (rollback).
NER: distilbert-base-multilingual-cased-ner-hrl (unchanged).
Sources: ibm-granite, onnx-community, Xenova ONNX exports."""
import os
import urllib.request

BASE = "https://huggingface.co"
TARGETS = [
    ("multilingual-e5-small", f"{BASE}/Xenova/multilingual-e5-small/resolve/main", ["onnx/model_quantized.onnx:model_int8.onnx", "tokenizer.json"]),
    ("distilbert-ner", f"{BASE}/Xenova/distilbert-base-multilingual-cased-ner-hrl/resolve/main", ["onnx/model_quantized.onnx:model_int8.onnx", "tokenizer.json"]),
    ("tinybert-rerank", f"{BASE}/Xenova/ms-marco-TinyBERT-L-2-v2/resolve/main", ["onnx/model_quantized.onnx:model_int8.onnx", "tokenizer.json"]),
    # granite-embedding-97m-r2 — новый embedder (SELECTED): int8 avx2, 94MB, 384-dim, first-pooling
    ("granite-embedding-r2", f"{BASE}/ibm-granite/granite-embedding-97m-multilingual-r2/resolve/main", ["onnx/model_quint8_avx2.onnx:model_int8.onnx", "tokenizer.json"]),
    # gte-multilingual-reranker-base — новый reranker (SELECTED): int8, 340MB
    ("gte-reranker", f"{BASE}/onnx-community/gte-multilingual-reranker-base/resolve/main", ["onnx/model_int8.onnx:model_int8.onnx", "tokenizer.json"]),
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
