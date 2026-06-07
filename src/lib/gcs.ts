import { Storage } from "@google-cloud/storage";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// 認証は Application Default Credentials (ADC) を利用する。
// - ローカル: `gcloud auth application-default login` もしくは GOOGLE_APPLICATION_CREDENTIALS にサービスアカウント鍵のパスを指定
// - Cloud Run: 実行サービスアカウントの権限で自動認証
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
});

function getBucketName(): string {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    throw new Error("環境変数 GCS_BUCKET が設定されていません");
  }
  return bucket;
}

/**
 * 署名付きURL等のソースURLからファイルをダウンロードし、GCSへストリーミング保存する。
 * 大容量(録画動画)でもメモリに載せず転送できる。
 *
 * @returns 保存先の gs:// パス
 */
export async function uploadFromUrlToGcs(
  sourceUrl: string,
  destination: string,
  contentType = "application/octet-stream",
): Promise<string> {
  const bucketName = getBucketName();

  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) {
    throw new Error(`ソースのダウンロードに失敗しました: ${res.status} ${res.statusText}`);
  }

  const file = storage.bucket(bucketName).file(destination);
  const writeStream = file.createWriteStream({ resumable: true, contentType });

  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), writeStream);

  return `gs://${bucketName}/${destination}`;
}
