# Mac のコンテナで動かす

デモ銀行ページと USD/JPY 要因分解ウォーターフォールを nginx コンテナで配信します。
Apple Silicon（M1〜）/ Intel Mac のどちらでも同じ手順で動きます（使用イメージはマルチアーキ対応）。

## 1. 準備
コンテナ実行環境を1つ入れます（どれでも可）。
- Docker Desktop for Mac
- OrbStack（`docker` コマンド互換）
- colima（`brew install colima docker docker-compose && colima start`）

## 2. 起動
```sh
git clone https://github.com/Greenmountain80210/wxo_bank.git
cd wxo_bank
git checkout claude/fx-waterfall-chart-yen-iq6kfi
docker compose up -d --build
```
- デモ銀行ページ: http://localhost:8080/
- ウォーターフォール: http://localhost:8080/fx-waterfall/

停止: `docker compose down`

ポート 8080 が使用中なら `compose.yaml` の `"8080:80"` を `"8081:80"` などに変えてください。

## 3. テストをコンテナで実行（任意）
```sh
docker compose --profile test run --rm test
```
Playwright 公式イメージ（Chromium 同梱）で単体テストと画面テストを実行します。

## compose を使わない場合
```sh
docker build -t wxo-bank-web .
docker run -d --rm --name wxo-web -p 8080:80 wxo-bank-web
```

## 補足
- データを変えたら `docker compose up -d --build` で再ビルドすると反映されます。
- Docker Hub のレート制限で nginx の取得に失敗する場合は、ミラーを指定できます:
  `docker build --build-arg NGINX_IMAGE=mirror.gcr.io/library/nginx:1.27-alpine -t wxo-bank-web .`
- トップページのチャットウィジェット（watsonx）は外部スクリプトを読み込むため、インターネット接続が必要です。ウォーターフォールはオフラインでも動きます。
