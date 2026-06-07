-- CreateTable
CREATE TABLE "meeting_chunks" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "clientId" TEXT,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_chunks_clientId_idx" ON "meeting_chunks"("clientId");

-- CreateIndex
CREATE INDEX "meeting_chunks_meetingId_idx" ON "meeting_chunks"("meetingId");

-- AddForeignKey
ALTER TABLE "meeting_chunks" ADD CONSTRAINT "meeting_chunks_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (pgvector: コサイン類似度用 HNSW インデックス)
CREATE INDEX "meeting_chunks_embedding_idx" ON "meeting_chunks" USING hnsw ("embedding" vector_cosine_ops);
