FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
COPY package.json .

RUN apt-get update && apt-get install -y gpgv && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt

# Keyring of the woob bank modules: gpgv checks them before they are installed
COPY docker/woob-keyring/ /root/.local/share/woob/keyrings/
COPY docker/check_woob_keyring.py /tmp/check_woob_keyring.py
RUN python /tmp/check_woob_keyring.py && rm /tmp/check_woob_keyring.py

COPY ./app ./app
COPY ./static ./static
COPY CHANGELOG.md CHANGELOG.fr.md ./

EXPOSE 8434

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8434/api/health', timeout=4)" || exit 1

# Production: no auto-reload. docker-compose.yml re-enables it for local development.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8434"]
