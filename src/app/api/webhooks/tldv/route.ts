import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadFromUrlToGcs } from "@/lib/gcs";
import {
  getRecordingDownloadUrl,
  transcriptToPlainText,
  type TldvMeeting,
} from "@/lib/tldv";
import { buildRecordingObjectName } from "@/lib/naming";
import { resolveClientIdFromMeetingName } from "@/lib/clientMatching";

// 録画ダウンロード等で時間がかかるため、Node.js ランタイムで実行する。
export const runtime = "nodejs";

type MeetingReadyPayload = {
  id: string;
  event: "MeetingReady";
  data: TldvMeeting;
  executedAt: string;
};

type TranscriptReadyPayload = {
  id: string;
  event: "TranscriptReady";
  data: {
    id: string;
    meetingId: string;
    data: { transcript?: string; segments?: { text: string }[] };
  };
  executedAt: string;
};

type TldvWebhookPayload = MeetingReadyPayload | TranscriptReadyPayload;

/**
 * tl;dv からの Webhook 受け口。
 * - MeetingReady: 会議メタデータを保存し、録画をGCSへ自動保存(会議名⇄ファイル名を紐付け)
 * - TranscriptReady: 文字起こしを保存
 *
 * NOTE: 録画ダウンロードは時間がかかるため、本番では Cloud Tasks 等で
 *       非同期処理にオフロードするのが望ましい(まずは同期処理で雛形を実装)。
 */
export async function POST(request: NextRequest) {
  // 共有シークレットによる簡易検証(Webhook URL に ?secret=... を付与、または x-webhook-secret ヘッダ)
  const expectedSecret = process.env.TLDV_WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided =
      request.headers.get("x-webhook-secret") ??
      request.nextUrl.searchParams.get("secret");
    if (provided !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: TldvWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (payload.event === "MeetingReady") {
      await handleMeetingReady(payload.data);
    } else if (payload.event === "TranscriptReady") {
      await handleTranscriptReady(payload.data);
    } else {
      return NextResponse.json({ error: "Unsupported event" }, { status: 400 });
    }
  } catch (err) {
    console.error("[tldv webhook] 処理に失敗しました", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleMeetingReady(meeting: TldvMeeting): Promise<void> {
  const happenedAt = meeting.happenedAt ? new Date(meeting.happenedAt) : null;

  // 会議名のタグ(例:【ClientA】)からクライアントを判定。未判定は null = 非公開扱い
  const clientId = await resolveClientIdFromMeetingName(meeting.name);

  // tldvMeetingId を一意キーに upsert することで Webhook 再送時の二重保存を防ぐ
  await prisma.meeting.upsert({
    where: { tldvMeetingId: meeting.id },
    create: {
      tldvMeetingId: meeting.id,
      name: meeting.name,
      happenedAt,
      durationSec: meeting.duration ?? null,
      tldvUrl: meeting.url ?? null,
      conferenceId: meeting.extraProperties?.conferenceId ?? null,
      organizerName: meeting.organizer?.name ?? null,
      organizerEmail: meeting.organizer?.email ?? null,
      invitees: meeting.invitees ?? undefined,
      clientId,
    },
    update: {
      name: meeting.name,
      happenedAt,
      durationSec: meeting.duration ?? null,
      tldvUrl: meeting.url ?? null,
      conferenceId: meeting.extraProperties?.conferenceId ?? null,
      organizerName: meeting.organizer?.name ?? null,
      organizerEmail: meeting.organizer?.email ?? null,
      invitees: meeting.invitees ?? undefined,
      clientId,
    },
  });

  // すでに録画保存済みなら何もしない(冪等性)
  const existing = await prisma.meeting.findUnique({
    where: { tldvMeetingId: meeting.id },
    select: { recordingStatus: true },
  });
  if (existing?.recordingStatus === "STORED") {
    return;
  }

  try {
    const downloadUrl = await getRecordingDownloadUrl(meeting.id);
    const objectName = buildRecordingObjectName(meeting.name, meeting.happenedAt, meeting.id);
    const gcsPath = await uploadFromUrlToGcs(downloadUrl, objectName, "video/mp4");

    await prisma.meeting.update({
      where: { tldvMeetingId: meeting.id },
      data: { recordingGcsPath: gcsPath, recordingStatus: "STORED" },
    });
  } catch (err) {
    console.error("[tldv webhook] 録画のGCS保存に失敗", err);
    await prisma.meeting.update({
      where: { tldvMeetingId: meeting.id },
      data: { recordingStatus: "FAILED" },
    });
    throw err;
  }
}

async function handleTranscriptReady(
  data: TranscriptReadyPayload["data"],
): Promise<void> {
  const meetingId = data.meetingId;

  // Webhook ペイロードに含まれる文字起こしを優先し、無ければ segments から再構成
  let text = data.data?.transcript ?? "";
  if (!text && data.data?.segments?.length) {
    text = data.data.segments.map((s) => s.text).join("\n");
  }
  // フォールバック: ペイロードに本文が無ければ API から取得
  if (!text) {
    const { getTranscript } = await import("@/lib/tldv");
    const transcript = await getTranscript(meetingId);
    text = transcriptToPlainText(transcript);
  }

  // 文字起こしが先に届くケースに備え upsert
  await prisma.meeting.upsert({
    where: { tldvMeetingId: meetingId },
    create: {
      tldvMeetingId: meetingId,
      name: `(未取得) ${meetingId}`,
      transcript: text,
      transcriptStatus: "STORED",
    },
    update: {
      transcript: text,
      transcriptStatus: "STORED",
    },
  });

  // TODO: ここで文字起こしをチャンク化し、embedding を生成して pgvector に格納(RAG)
}
