import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { answerQuestion } from "@/lib/rag";

export const runtime = "nodejs";

/**
 * チャット送信。会議記録(該当クライアント分のみ)を根拠に回答する。
 * - clientId を指定すると、そのクライアントの会議記録のみを検索(テナント分離)
 * - clientId 未指定なら未割り当て(社内)の会議記録のみを対象
 */
export async function POST(request: NextRequest) {
  let body: { conversationId?: string; message?: string; clientId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message は必須です" }, { status: 400 });
  }

  const clientId = body.clientId ?? null;

  // 会話の取得/作成
  const conversation = body.conversationId
    ? await prisma.conversation.findUnique({ where: { id: body.conversationId } })
    : await prisma.conversation.create({
        data: { title: message.slice(0, 50), clientId },
      });

  if (!conversation) {
    return NextResponse.json({ error: "会話が見つかりません" }, { status: 404 });
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "USER", content: message },
  });

  // RAG: 会議記録を検索して回答を生成
  const { answer, sources } = await answerQuestion(conversation.clientId ?? clientId, message);

  const assistantMessage = await prisma.message.create({
    data: { conversationId: conversation.id, role: "ASSISTANT", content: answer },
  });

  return NextResponse.json({
    conversationId: conversation.id,
    reply: assistantMessage.content,
    sources,
  });
}

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId は必須です" }, { status: 400 });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ conversationId, messages });
}
