FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /srv
COPY pyproject.toml ./
RUN uv pip install --system -r pyproject.toml
# ONNX weights are baked into a cached layer (~300 MB), never committed to git
COPY scripts_download_models.py ./
ENV MODELS_DIR=/models
RUN python scripts_download_models.py
COPY app ./app
COPY clients ./clients
ENV RAG_DB=/data/rag.db RAG_FILES=/data/files ONNX_THREADS=2 PORT=8080
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
