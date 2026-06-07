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

> 注: 現在 AI の応答ロジックはダミーです。`src/app/api/chat/route.ts` の `TODO` 箇所で AI サービス（OpenAI 等）と連携してください。

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
