# syntax=docker/dockerfile:1
# デモ銀行ページと USD/JPY 要因分解ウォーターフォールを配信するコンテナ。
# Apple Silicon (arm64) / Intel (amd64) どちらの Mac でもそのまま動く（公式イメージがマルチアーキ対応）。

ARG NGINX_IMAGE=nginx:1.27-alpine
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble

# ---- テスト用ステージ: docker build --target test . -------------------------
FROM ${PLAYWRIGHT_IMAGE} AS test
WORKDIR /app
# イメージ同梱のブラウザと同じ版の playwright パッケージを入れる
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.63.0
COPY package.json ./package.json
COPY fx-waterfall ./fx-waterfall
CMD ["npm", "test"]

# ---- 配信用ステージ（既定）: docker build . ---------------------------------
FROM ${NGINX_IMAGE} AS web
# README.md の中身はデモ銀行の HTML なので、トップページとして配信する
COPY README.md /usr/share/nginx/html/index.html
COPY DTE_Bank_wxO.png /usr/share/nginx/html/
COPY fx-waterfall/index.html fx-waterfall/waterfall.js fx-waterfall/chart.js fx-waterfall/app.js /usr/share/nginx/html/fx-waterfall/
COPY fx-waterfall/data /usr/share/nginx/html/fx-waterfall/data
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/fx-waterfall/ >/dev/null || exit 1
