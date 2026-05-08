FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
COPY package.json .

RUN pip install --no-cache-dir -r requirements.txt

# We mount /app/app at runtime for dev, but we copy it for prod
COPY ./app ./app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8434", "--reload"]
