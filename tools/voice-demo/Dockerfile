# syntax=docker/dockerfile:1
FROM python:3.12-slim-trixie
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    apt-get update && apt-get install -y --no-install-recommends \
    chromium pulseaudio pulseaudio-utils ca-certificates tini espeak-ng \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 demo
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; \
    pip install --no-cache-dir -r requirements.txt
COPY *.py *.html *.sh ./
RUN chmod +x /app/*.sh
USER demo
ENV DEMO_RUNTIME=/tmp/lukas-voice-demo
ENV PULSE_SERVER=unix:/tmp/lukas-voice-demo/pulse.sock
ENV PYTHONDONTWRITEBYTECODE=1
ENV DEMO_REPORT=/tmp/lukas-voice-demo/audio-test.json
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
CMD ["test_audio.py"]
