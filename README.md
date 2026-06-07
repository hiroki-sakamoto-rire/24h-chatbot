# 24時間対応のチャットボット

24時間いつでもユーザーからの問い合わせに自動で応答するチャットボットです。

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router) / React 19
- **言語**: TypeScript
- **ORM**: Prisma 7
- **データベース**: PostgreSQL
- **スタイリング**: Tailwind CSS v4
- **本番環境**: Google Cloud (Cloud Run + Cloud SQL を想定)

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、`DATABASE_URL` を設定します。

```bash
cp .env.example .env
```

### 3. データベースのマイグレーション

ローカルの PostgreSQL を起動した上で実行します。

```bash
npm run db:migrate
```

### 4. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 を開きます。

## 主なスクリプト

| コマンド | 説明 |
| --- | --- |
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド (standalone 出力) |
| `npm run start` | 本番サーバー起動 |
| `npm run db:migrate` | 開発用マイグレーション |
| `npm run db:deploy` | 本番用マイグレーション適用 |
| `npm run db:studio` | Prisma Studio 起動 |

## API

| メソッド | パス | 説明 |
| --- | --- | --- |
| `POST` | `/api/chat` | メッセージ送信し応答を取得 |
| `GET` | `/api/chat?conversationId=...` | 会話履歴の取得 |
| `GET` | `/api/health` | ヘルスチェック |
| `POST` | `/api/webhooks/tldv` | tl;dv Webhook 受け口（録画・文字起こしの自動保存） |

> 注: 現在 AI の応答ロジックはダミーです。`src/app/api/chat/route.ts` の `TODO` 箇所で AI サービス（Gemini 等）と連携してください。

## Zoom録画の自動保存パイプライン（tl;dv → GCP）

Zoom会議終了後、tl;dv が録画・文字起こしを生成し、Webhook で本アプリに通知します。本アプリは録画を **GCS** に、文字起こし・メタデータを **Cloud SQL (PostgreSQL)** に保存し、**Zoom会議名と GCP 内ファイル名を `Meeting` テーブルで紐付け**ます。

```
[Zoom] →(tl;dv bot)→ [tl;dv] ──Webhook──► [/api/webhooks/tldv]
                                              ├─ MeetingReady    → 録画(mp4)を GCS に保存 + Meeting upsert
                                              └─ TranscriptReady → 文字起こしを Cloud SQL に保存
```

- **GCSオブジェクト名**: `recordings/YYYY/MM/DD/YYYY-MM-DD_<会議名>_<tldvMeetingId>.mp4`
- **紐付け**: `meetings.name`（元のZoom会議名）と `meetings.recordingGcsPath`（GCPファイルパス）を保持
- **冪等性**: `tldvMeetingId` を一意キーにし、Webhook再送時の二重保存を防止

### 関連ファイル

| ファイル | 役割 |
| --- | --- |
| `src/app/api/webhooks/tldv/route.ts` | Webhook 受け口・処理本体 |
| `src/lib/tldv.ts` | tl;dv API クライアント |
| `src/lib/gcs.ts` | GCS へのストリーミングアップロード |
| `src/lib/naming.ts` | 会議名→ファイル名の命名規則 |
| `prisma/schema.prisma` | `Meeting` モデル |

### セットアップ手順

1. **tl;dv**: API キーを発行（Pro/Business/Enterprise プランが必要）し、Webhook（`MeetingReady` / `TranscriptReady`）の通知先を `https://<デプロイURL>/api/webhooks/tldv?secret=<TLDV_WEBHOOK_SECRET>` に設定。全Zoom会議を自動録画する設定にすると完全自動になります。
2. **GCP**: 録画保存用の GCS バケットを作成。Cloud Run 実行サービスアカウントに当該バケットへの `roles/storage.objectAdmin` を付与。
3. **環境変数**: `.env.example` を参照して `TLDV_API_KEY` / `TLDV_WEBHOOK_SECRET` / `GCP_PROJECT_ID` / `GCS_BUCKET` を設定。

> 注: 録画ダウンロードは時間がかかるため、本番では Cloud Tasks 等で非同期処理にオフロードするのが望ましいです（現状は同期処理の雛形）。文字起こしの embedding 生成（RAG）は `handleTranscriptReady` の `TODO` 箇所で実装します。

## Google Cloud へのデプロイ (Cloud Run)

`output: "standalone"` でビルドした Docker イメージを Cloud Run にデプロイします。

```bash
# プロジェクト設定
gcloud config set project YOUR_PROJECT_ID

# ビルド & デプロイ
gcloud run deploy 24h-chatbot \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --set-env-vars DATABASE_URL="YOUR_CLOUD_SQL_URL"
```

Cloud SQL (PostgreSQL) を利用する場合は `--add-cloudsql-instances` で接続し、`DATABASE_URL` に Unix ソケットのパスを指定します。
