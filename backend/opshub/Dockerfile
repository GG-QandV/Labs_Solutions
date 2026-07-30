FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /opshub
COPY pyproject.toml ./
RUN uv pip install --system -r pyproject.toml
COPY app ./app
COPY clients ./clients
ENV OPSHUB_DB=/data/opshub.db PORT=8700
VOLUME /data
EXPOSE 8700
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8700/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8700"]
