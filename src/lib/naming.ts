/**
 * Zoom会議名を GCS オブジェクト名に使える形へ安全化する。
 * - 日本語などのUnicodeはそのまま残す(GCSは許可)
 * - パスやURLを壊す文字・空白は "_" に置換
 * - 長すぎる名前は切り詰める
 */
export function sanitizeForObjectName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "") // 制御文字を除去
    .replace(/[/\\?%*:|"<>#\[\]\s]+/g, "_") // パス/URLを壊す文字と空白
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return cleaned || "meeting";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 録画ファイルのGCSオブジェクト名(キー)を生成する。
 * Zoom会議名・日付・tl;dv会議IDを含め、人が見て分かりつつ機械的に一意にする。
 *
 * 例: recordings/2026/06/07/2026-06-07_営業定例MTG_abc123.mp4
 */
export function buildRecordingObjectName(
  meetingName: string,
  happenedAt: Date | string | undefined,
  tldvMeetingId: string,
  extension = "mp4",
): string {
  const date = happenedAt ? new Date(happenedAt) : new Date();
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const slug = sanitizeForObjectName(meetingName);
  const datePrefix = `${yyyy}-${mm}-${dd}`;

  return `recordings/${yyyy}/${mm}/${dd}/${datePrefix}_${slug}_${tldvMeetingId}.${extension}`;
}
