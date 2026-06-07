const TLDV_BASE_URL = "https://pasta.tldv.io/v1alpha1";

function authHeaders(): HeadersInit {
  const apiKey = process.env.TLDV_API_KEY;
  if (!apiKey) {
    throw new Error("環境変数 TLDV_API_KEY が設定されていません");
  }
  return { "x-api-key": apiKey, "Content-Type": "application/json" };
}

export type TldvMeeting = {
  id: string;
  name: string;
  happenedAt?: string;
  url?: string;
  duration?: number;
  organizer?: { name?: string; email?: string };
  invitees?: { name?: string; email?: string }[];
  template?: unknown;
  extraProperties?: { conferenceId?: string };
};

export type TldvTranscript = {
  id: string;
  meetingId: string;
  data: { speaker?: string; text: string; startTime?: number; endTime?: number }[];
};

export async function getMeeting(meetingId: string): Promise<TldvMeeting> {
  const res = await fetch(`${TLDV_BASE_URL}/meetings/${meetingId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`tl;dv 会議取得に失敗: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getTranscript(meetingId: string): Promise<TldvTranscript> {
  const res = await fetch(`${TLDV_BASE_URL}/meetings/${meetingId}/transcript`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`tl;dv 文字起こし取得に失敗: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * 録画ファイルの署名付きダウンロードURLを取得する。
 * /download は 302 リダイレクトを返すため、Location ヘッダから署名URLを読み取る。
 * 署名URLは発行から6時間で失効する点に注意。
 */
export async function getRecordingDownloadUrl(meetingId: string): Promise<string> {
  const res = await fetch(`${TLDV_BASE_URL}/meetings/${meetingId}/download`, {
    headers: authHeaders(),
    redirect: "manual",
  });

  const location = res.headers.get("location");
  if (location) {
    return location;
  }

  // リダイレクトが自動追従された場合は最終URLを使う
  if (res.ok && res.url) {
    return res.url;
  }

  throw new Error(`tl;dv 録画URLの取得に失敗: ${res.status} ${res.statusText}`);
}

/** 構造化された文字起こしをプレーンテキストに整形する */
export function transcriptToPlainText(transcript: TldvTranscript): string {
  return transcript.data
    .map((seg) => (seg.speaker ? `${seg.speaker}: ${seg.text}` : seg.text))
    .join("\n");
}
