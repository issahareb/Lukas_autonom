# syntax=docker/dockerfile:1
FROM python:3.12-slim-trixie
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium pulseaudio pulseaudio-utils ca-certificates tini espeak-ng \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 demo
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=demo:demo *.py *.html *.sh ./
RUN chmod +x /app/*.sh
USER demo
ENV DEMO_RUNTIME=/tmp/lukas-voice-demo
ENV PULSE_SERVER=unix:/tmp/lukas-voice-demo/pulse.sock
ENV PYTHONDONTWRITEBYTECODE=1
ENV DEMO_REPORT=/tmp/lukas-voice-demo/audio-test.json
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
CMD ["test_audio.py"]
