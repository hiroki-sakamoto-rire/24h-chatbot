import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  let body: { conversationId?: string; message?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message は必須です" }, { status: 400 });
  }

  const conversation = body.conversationId
    ? await prisma.conversation.findUnique({ where: { id: body.conversationId } })
    : await prisma.conversation.create({ data: { title: message.slice(0, 50) } });

  if (!conversation) {
    return NextResponse.json({ error: "会話が見つかりません" }, { status: 404 });
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "USER", content: message },
  });

  // TODO: ここでAIサービス（OpenAI等）に問い合わせて応答を生成する
  const reply = `「${message}」を受け取りました。AI応答ロジックは後で実装します。`;

  const assistantMessage = await prisma.message.create({
    data: { conversationId: conversation.id, role: "ASSISTANT", content: reply },
  });

  return NextResponse.json({
    conversationId: conversation.id,
    reply: assistantMessage.content,
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
