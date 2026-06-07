"use client";

import { useRef, useState } from "react";

type ChatMessage = {
  role: "USER" | "ASSISTANT";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const conversationId = useRef<string | null>(null);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "USER", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId.current,
          message: text,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        conversationId.current = data.conversationId;
        setMessages((prev) => [...prev, { role: "ASSISTANT", content: data.reply }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "ASSISTANT", content: `エラー: ${data.error ?? "不明なエラー"}` },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "ASSISTANT", content: "通信エラーが発生しました。" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col p-4">
      <header className="border-b border-black/10 pb-4 dark:border-white/10">
        <h1 className="text-xl font-bold">24時間対応のチャットボット</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          いつでもお気軽にメッセージをどうぞ
        </p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-black/40 dark:text-white/40">
            メッセージを送信して会話を始めましょう
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "USER" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                m.role === "USER"
                  ? "bg-blue-600 text-white"
                  : "bg-black/5 text-black dark:bg-white/10 dark:text-white"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-black/5 px-4 py-2 text-sm text-black/50 dark:bg-white/10 dark:text-white/50">
              入力中…
            </div>
          </div>
        )}
      </div>

      <form onSubmit={sendMessage} className="flex gap-2 border-t border-black/10 pt-4 dark:border-white/10">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力…"
          className="flex-1 rounded-full border border-black/15 bg-transparent px-4 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          送信
        </button>
      </form>
    </main>
  );
}
