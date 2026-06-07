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

### クライアント別ボット（マルチテナント）

社外向けに会議記録も知識源とするため、**クライアントごとにデータを分離**します。各クライアントのボットは自社分の会議記録のみを参照します。

- **判定方法**: Zoom会議名の先頭タグでクライアントを自動判定（例: `【ClientA】定例MTG` → ClientA）
- **対応括弧**: `【】` `[]` `「」` `［］`
- **タグ無しの会議**: どのクライアントにも紐付かず（`clientId = null`）、外部には公開されない安全側の扱い
- **データ分離**: `Client` を単位に `Meeting` / `Conversation` を `clientId` で分離。検索時は必ず `clientId` で絞り込む
- **アクセス方法**: 未定（`Client.accessToken` を用意済み。専用URL or ログインを後で実装可能）

> 注意: クライアント単位の分離で他社への漏洩は防げますが、同一クライアントとの会議内の「社内限定の発言」までは分離されません。必要に応じて後から要注意フラグ等で対策します。

### 関連ファイル

| ファイル | 役割 |
| --- | --- |
| `src/app/api/webhooks/tldv/route.ts` | Webhook 受け口・処理本体 |
| `src/lib/tldv.ts` | tl;dv API クライアント |
| `src/lib/gcs.ts` | GCS へのストリーミングアップロード |
| `src/lib/naming.ts` | 会議名→ファイル名の命名規則 |
| `src/lib/clientMatching.ts` | 会議名タグ→クライアント判定（マルチテナント） |
| `src/lib/openai.ts` | OpenAI クライアント（埋め込み・チャット） |
| `src/lib/rag.ts` | RAG（チャンク化・インデックス・ベクトル検索・回答生成） |
| `prisma/schema.prisma` | `Client` / `Meeting` / `MeetingChunk` / `Conversation` モデル |

### RAG（会議記録から回答する仕組み）

1. `TranscriptReady` 受信時、文字起こしをチャンク分割し OpenAI(`text-embedding-3-small`)で埋め込み → `meeting_chunks`(pgvector) に保存
2. チャット質問時、質問を埋め込み → pgvector のコサイン類似度で関連チャンクを取得（`clientId` で絞り込み）→ OpenAI(`gpt-4o-mini`)で回答生成
3. 回答には出典（どの会議か）を付与

> 重要(tl;dv仕様): **Freeユーザーが主催した会議はAPIで取得できません**（`ForbiddenError`）。録画・文字起こしを取り込むには、Pro以上のユーザーが会議の主催者である必要があります。

### セットアップ手順

1. **tl;dv**: API キーを発行（Pro/Business/Enterprise プランが必要）し、Webhook（`MeetingReady` / `TranscriptReady`）の通知先を `https://<デプロイURL>/api/webhooks/tldv?secret=<TLDV_WEBHOOK_SECRET>` に設定。全Zoom会議を自動録画する設定にすると完全自動になります。
2. **GCP**: 録画保存用の GCS バケットを作成。Cloud Run 実行サービスアカウントに当該バケットへの `roles/storage.objectAdmin` を付与。
3. **環境変数**: `.env.example` を参照して `TLDV_API_KEY` / `TLDV_WEBHOOK_SECRET` / `GCP_PROJECT_ID` / `GCS_BUCKET` を設定。

> 注: 録画ダウンロードは時間がかかるため、本番では Cloud Tasks 等で非同期処理にオフロードするのが望ましいです（現状は同期処理の雛形）。文字起こしの embedding 生成（RAG）は `handleTranscriptReady` の `TODO` 箇所で実装します。

## 本番環境 (デプロイ済み)

- **サービスURL**: https://chatbot-24h-2440426568.asia-northeast1.run.app
- **Cloud Run サービス名**: `chatbot-24h`（リージョン: asia-northeast1）
- **DB**: Cloud SQL `chatbot-db`（PostgreSQL 16 + pgvector）/ Unix ソケット接続
- **録画保存**: GCS `24h-chatbot-recordings-hazel-tome-495507-r6`
- **シークレット**: Secret Manager（`openai-api-key` / `tldv-api-key` / `tldv-webhook-secret` / `database-url`）

### 再デプロイ方法

```bash
gcloud run deploy chatbot-24h \
  --source . \
  --region=asia-northeast1 \
  --allow-unauthenticated \
  --add-cloudsql-instances=hazel-tome-495507-r6:asia-northeast1:chatbot-db \
  --set-env-vars="GCP_PROJECT_ID=hazel-tome-495507-r6,GCS_BUCKET=24h-chatbot-recordings-hazel-tome-495507-r6" \
  --set-secrets="OPENAI_API_KEY=openai-api-key:latest,TLDV_API_KEY=tldv-api-key:latest,TLDV_WEBHOOK_SECRET=tldv-webhook-secret:latest,DATABASE_URL=database-url:latest" \
  --memory=1Gi --cpu=1 --timeout=300
```

### tl;dv Webhook 登録

tl;dv の Webhook 通知先に以下を設定（`MeetingReady` / `TranscriptReady` を有効化）:

```
https://chatbot-24h-2440426568.asia-northeast1.run.app/api/webhooks/tldv?secret=<TLDV_WEBHOOK_SECRET>
```

### ローカルから DB へ接続（マイグレーション等）

```bash
cloud-sql-proxy hazel-tome-495507-r6:asia-northeast1:chatbot-db --port 5433 &
# .env の DATABASE_URL は localhost:5433 を指す
npx prisma migrate deploy
```

## Google Cloud へのデプロイ (Cloud Run) ※汎用手順

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
