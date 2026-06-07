import { prisma } from "@/lib/prisma";
import { createEmbedding, createEmbeddings, getOpenAI, CHAT_MODEL } from "@/lib/openai";

const CHUNK_SIZE = 1200; // 1チャンクあたりのおおよその文字数
const CHUNK_OVERLAP = 200; // チャンク間の重なり(文脈の途切れ防止)
const RETRIEVE_TOP_K = 6;

/** テキストを重なり付きのチャンクに分割する */
export function chunkText(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    chunks.push(clean.slice(start, end));
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

/** pgvector に渡すためベクトルを文字列リテラルに変換する */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * 指定した会議の文字起こしをチャンク化・埋め込みし、meeting_chunks に保存する。
 * 既存チャンクは作り直す(冪等)。
 */
export async function indexMeetingTranscript(meetingId: string): Promise<number> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, clientId: true, transcript: true },
  });
  if (!meeting?.transcript) return 0;

  const chunks = chunkText(meeting.transcript);
  if (chunks.length === 0) return 0;

  // 既存チャンクを削除してから作り直す
  await prisma.meetingChunk.deleteMany({ where: { meetingId } });

  const embeddings = await createEmbeddings(chunks);

  // 埋め込みは Unsupported 型のため raw SQL で挿入する
  for (let i = 0; i < chunks.length; i++) {
    const id = `${meetingId}_${i}_${Date.now()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "meeting_chunks" ("id", "meetingId", "clientId", "chunkIndex", "content", "embedding")
       VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      id,
      meetingId,
      meeting.clientId,
      i,
      chunks[i],
      toVectorLiteral(embeddings[i]),
    );
  }

  return chunks.length;
}

export type RetrievedChunk = {
  id: string;
  meetingId: string;
  content: string;
  score: number;
  meetingName: string | null;
  happenedAt: Date | null;
};

/**
 * 質問に類似するチャンクを clientId で絞り込んで取得する。
 * clientId を必ず指定することで、他クライアントの情報が混ざらないようにする。
 */
export async function retrieveContext(
  clientId: string | null,
  question: string,
  topK = RETRIEVE_TOP_K,
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await createEmbedding(question);
  const vec = toVectorLiteral(queryEmbedding);

  // clientId が null のときは「未割り当て(社内)」のチャンクのみを対象にする
  const clientCondition = clientId
    ? `mc."clientId" = $2`
    : `mc."clientId" IS NULL`;

  const params: unknown[] = [vec];
  if (clientId) params.push(clientId);
  params.push(topK);
  const limitIdx = clientId ? 3 : 2;

  const rows = await prisma.$queryRawUnsafe<
    {
      id: string;
      meetingId: string;
      content: string;
      score: number;
      name: string | null;
      happenedAt: Date | null;
    }[]
  >(
    `SELECT mc."id", mc."meetingId", mc."content",
            1 - (mc."embedding" <=> $1::vector) AS score,
            m."name", m."happenedAt"
     FROM "meeting_chunks" mc
     JOIN "meetings" m ON m."id" = mc."meetingId"
     WHERE ${clientCondition} AND mc."embedding" IS NOT NULL
     ORDER BY mc."embedding" <=> $1::vector
     LIMIT $${limitIdx}`,
    ...params,
  );

  return rows.map((r) => ({
    id: r.id,
    meetingId: r.meetingId,
    content: r.content,
    score: Number(r.score),
    meetingName: r.name,
    happenedAt: r.happenedAt,
  }));
}

export type AnswerResult = {
  answer: string;
  sources: { meetingName: string | null; happenedAt: Date | null; score: number }[];
};

/**
 * 質問に対し、該当クライアントの会議記録のみを根拠に回答を生成する。
 */
export async function answerQuestion(
  clientId: string | null,
  question: string,
): Promise<AnswerResult> {
  const contexts = await retrieveContext(clientId, question);

  if (contexts.length === 0) {
    return {
      answer:
        "申し訳ありません。その質問に回答できる会議記録が見つかりませんでした。",
      sources: [],
    };
  }

  const contextText = contexts
    .map(
      (c, i) =>
        `【資料${i + 1}: ${c.meetingName ?? "会議"}${
          c.happenedAt ? ` (${c.happenedAt.toISOString().slice(0, 10)})` : ""
        }】\n${c.content}`,
    )
    .join("\n\n---\n\n");

  const completion = await getOpenAI().chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "あなたは会議記録にもとづいて質問に答えるアシスタントです。" +
          "以下の【資料】に書かれている情報のみを根拠に、日本語で簡潔かつ正確に回答してください。" +
          "資料に答えが無い場合は、推測せず『資料からは分かりません』と答えてください。",
      },
      {
        role: "user",
        content: `# 資料\n${contextText}\n\n# 質問\n${question}`,
      },
    ],
  });

  const answer =
    completion.choices[0]?.message?.content?.trim() ??
    "回答を生成できませんでした。";

  return {
    answer,
    sources: contexts.map((c) => ({
      meetingName: c.meetingName,
      happenedAt: c.happenedAt,
      score: c.score,
    })),
  };
}
