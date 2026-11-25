# BIRGSOL Cloud Browser — Hugging Face Space (Docker, free CPU tier).
# Base image already ships Chromium + all OS deps for Playwright.
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Ensure the Chromium build matching the installed Playwright exists (belt-and-suspenders).
RUN playwright install chromium

COPY app.py .

# Render sets $PORT; default to 7860 elsewhere. Shell form so $PORT expands.
EXPOSE 7860
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860}
