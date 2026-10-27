FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/* && useradd -m -u 1001 browser
ENV BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
COPY proxy.mjs engine.mjs server.mjs test.mjs ./
RUN node --test test.mjs
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV PORT=8080 BROWSER_DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
