import { prisma } from "@/lib/prisma";

/**
 * Zoom会議名の先頭に付いたタグからクライアント名を抽出する。
 * 対応する括弧: 【】 / [] / 「」 / ［］
 *
 * 例:
 *   "【ClientA】定例MTG"   → "ClientA"
 *   "[ClientB] Weekly"     → "ClientB"
 *   "社内ミーティング"      → null (タグ無し)
 */
export function extractClientTag(meetingName: string): string | null {
  const match = meetingName
    .trim()
    .match(/^[\s]*[【\[「［]\s*([^】\]」］]+?)\s*[】\]」］]/);
  if (!match) return null;
  const tag = match[1].trim();
  return tag.length > 0 ? tag : null;
}

function toSlug(tag: string): string {
  return tag
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9一-龯ぁ-んァ-ン]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * 会議名のタグからクライアントを解決する。
 * - タグが無ければ null (どのクライアントにも紐付けない=非公開扱い)
 * - 既存クライアントが見つかればそのidを返す
 * - 見つからなければ自動作成する(完全自動運用のため)
 *
 * @returns 紐付けるべき clientId、または null
 */
export async function resolveClientIdFromMeetingName(
  meetingName: string,
): Promise<string | null> {
  const tag = extractClientTag(meetingName);
  if (!tag) return null;

  const slug = toSlug(tag) || tag;

  // nameTag または slug で既存を検索
  const existing = await prisma.client.findFirst({
    where: { OR: [{ nameTag: tag }, { slug }] },
    select: { id: true },
  });
  if (existing) return existing.id;

  // 未登録なら自動作成
  const created = await prisma.client.create({
    data: { name: tag, slug, nameTag: tag },
    select: { id: true },
  });
  return created.id;
}
