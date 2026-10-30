FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
COPY package.json .

RUN pip install --no-cache-dir -r requirements.txt

COPY ./app ./app
COPY ./static ./static
COPY CHANGELOG.md .

EXPOSE 8434

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8434/api/health', timeout=4)" || exit 1

# Production: no auto-reload. docker-compose.yml re-enables it for local development.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8434"]
