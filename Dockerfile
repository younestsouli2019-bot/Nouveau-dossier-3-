FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir cryptography>=41.0.7

COPY . .

CMD ["python", "khwarizmian_swarm_extended.py"]
