FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY engine.py .
COPY registry.json .

# copy certs via volume at runtime; do NOT bake private keys into image
ENV REGISTRY_PATH=/app/registry.json
ENV DB_PATH=/data/engine_state.sqlite
ENV HTTP_METRICS_PORT=8080

VOLUME ["/data", "/certs"]

EXPOSE 8080

CMD ["python", "engine.py"]
