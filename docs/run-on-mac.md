# Mac のコンテナで動かす

デモ銀行ページと USD/JPY 要因分解ウォーターフォールを nginx コンテナで配信します。
Apple Silicon（M1〜）/ Intel Mac のどちらでも同じ手順で動きます（使用イメージはマルチアーキ対応）。

## 1. 準備
コンテナ実行環境を1つ入れます（どれでも可）。
- Docker Desktop for Mac
- OrbStack（`docker` コマンド互換）
- colima（`brew install colima docker docker-compose && colima start`）

## 2. 起動（いちばん簡単な方法）
```sh
git clone https://github.com/Greenmountain80210/wxo_bank.git
cd wxo_bank
git checkout claude/fx-waterfall-chart-yen-iq6kfi
./mac/start.sh
```
または Finder で `mac/start.command` をダブルクリック。

`start.sh` が自動で行うこと:
1. docker コマンドを探す（Docker Desktop / OrbStack / Homebrew の場所も確認）
2. Docker エンジンが止まっていれば起動して待つ（OrbStack → Docker Desktop → colima の順に探す）
3. ポートが他のアプリに使われていないか確認
4. イメージを作成してコンテナを起動（Docker Hub から nginx を取得できない時は公式イメージのミラーで自動再試行）
5. 応答を確認してブラウザで http://localhost:8080/fx-waterfall/ を開く

| 操作 | コマンド | Finder |
|---|---|---|
| 起動 | `./mac/start.sh` | `mac/start.command` |
| 停止 | `./mac/stop.sh` | `mac/stop.command` |
| 停止してイメージも削除 | `./mac/stop.sh --all` | — |
| テスト実行 | `./mac/test.sh` | — |
| ポートを変える | `PORT=8081 ./mac/start.sh` | — |
| ブラウザを開かない | `NO_OPEN=1 ./mac/start.sh` | — |

- ポートは `127.0.0.1` にだけ公開するので、同じ Wi-Fi の他の端末からは見えません。
- `fx-waterfall/` はコンテナと共有しているので、データや HTML/JS を変えたらブラウザの再読み込みだけで反映されます（再ビルド不要）。
- トップページのチャット（watsonx）はインターネット接続が必要です。要因分解ツールはオフラインでも動きます。
- zip でダウンロードした場合、`.command` が「開発元を確認できない」と止められることがあります。その時は `xattr -dr com.apple.quarantine mac` を一度実行するか、右クリック →「開く」。

## Claude Code でこのリポジトリを直接改善する
```sh
./mac/claude.sh          # または Finder で mac/claude.command
```
- Claude Code 入りの開発用コンテナ（`wxo-bank-claude`）を起動し、その中で `claude` を対話モードで開きます。配信コンテナが止まっていれば一緒に起動します。
- リポジトリは `/workspace` に共有されるので、Claude の変更は Mac 側のファイルに残り、http://localhost:8080/fx-waterfall/ の再読み込みで確認できます。テスト（`npm test`）もコンテナ内でそのまま動きます。
- **初回ログイン**: 表示された URL を Mac のブラウザで開いて認証し、表示されたコードを貼り付けます。ログイン情報は Docker ボリューム `claude-config` に保存され、次回からは不要です。API キーを使う場合は `export ANTHROPIC_API_KEY=...` してから実行（キーをファイルに書かないこと）。
- プロジェクトの決まり（出典のない数値を入れない、売買推奨の表現を入れない、テストを通す等）は `CLAUDE.md` に書いてあり、Claude が自動で読み込みます。
- コミットはコンテナ内でもできますが、**push は Mac 側のターミナルで**行ってください（コンテナに GitHub の認証情報は入れていません）。コミットの作者名は `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL`（と `GIT_COMMITTER_*`）を Mac で export しておくと引き継がれます。

| 操作 | コマンド |
|---|---|
| Claude に 1 回だけ質問 | `./mac/claude.sh -p "テストを実行して結果を要約して"` |
| コンテナのシェルに入る | `./mac/claude.sh --shell` |
| Claude Code の版を上げる | `Dockerfile` の `CLAUDE_CODE_VERSION` を変えて `./mac/claude.sh --rebuild` |
| 書き込みエラー（Permission denied）が出る | `CLAUDE_USER=root ./mac/claude.sh` |
| ログイン情報も消す | `./mac/stop.sh --all && docker volume rm wxo_bank_claude-config` |

## 構成ファイル
| ファイル | 役割 |
|---|---|
| `Dockerfile` | `web`（nginx で配信）・`test`（全テスト）・`dev`（Claude Code 開発用）の 3 段構成 |
| `compose.yaml` | ポート・データ共有・ビルド引数の設定 |
| `docker/nginx.conf` | UTF-8 指定と、ツールのファイルを毎回再検証させる設定 |
| `.dockerignore` | イメージに入れないファイル |
| `mac/*.sh`, `mac/*.command` | 起動・停止・テスト・Claude Code のスクリプト（macOS 標準の bash 3.2 で動作） |
| `CLAUDE.md` | コンテナ内の Claude Code が読むプロジェクトの決まり |

## compose を直接使う場合
```sh
docker compose up -d --build        # 起動
docker compose down                  # 停止
docker compose --profile test run --rm --build test   # テスト
```
Docker Hub のレート制限で失敗する時: `NGINX_IMAGE=mirror.gcr.io/library/nginx:1.27-alpine docker compose up -d --build`

## 短期トレードでの使い方（A→B は 5分〜5日）
1. 取引ツールから USD/JPY の分足を CSV で書き出す
   - MT4: 「ツール → ヒストリーセンター」で USDJPY の M1/M5 を選び「エクスポート」
   - MT5: 「表示 → 銘柄 → チャートバー」で期間を指定して「バーをエクスポート」
   - TradingView: チャートの「チャートデータをエクスポート」
2. 画面の「CSV の時刻のタイムゾーン」を合わせる（MT4/MT5 は業者のサーバー時間。多くは +02:00、米夏時間中は +03:00）
3. 「イベント後の窓」（1/5/15/30/60 分）を選び「価格 CSV を読み込む」→ 各イベントの前後レートが自動で入る
4. 「B を最新に」で B 時点を CSV の最後の足に合わせる
5. 予定イベント（次の指標発表の時刻）と警戒ラインを入力すると、残り時間と距離が「売りエントリーの判断材料」に出る

※ 本ツールは過去データの集計です。将来の値動きの予測や売買の推奨ではありません。
