FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY packages ./packages
COPY services ./services

RUN pip install --no-cache-dir -e .

ENV PYTHONPATH=/app/services/api:/app/services/brain:/app/services/production:/app/services/ingest:/app/services/market:/app/packages/model_gateway:/app/packages/furniture_language:/app/packages/design_dna

WORKDIR /app/services/api

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
