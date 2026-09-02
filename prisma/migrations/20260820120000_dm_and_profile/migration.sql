-- CreateEnum
CREATE TYPE "DirectThreadStatus" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "socialEnergy" TEXT;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN "clientMessageId" TEXT;

-- CreateTable
CREATE TABLE "direct_threads" (
    "id" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "initiatedById" TEXT NOT NULL,
    "status" "DirectThreadStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "clientMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_messages_tableId_createdAt_idx" ON "chat_messages"("tableId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_tableId_clientMessageId_idx" ON "chat_messages"("tableId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "direct_threads_userLowId_userHighId_key" ON "direct_threads"("userLowId", "userHighId");

-- CreateIndex
CREATE INDEX "direct_threads_userLowId_status_idx" ON "direct_threads"("userLowId", "status");

-- CreateIndex
CREATE INDEX "direct_threads_userHighId_status_idx" ON "direct_threads"("userHighId", "status");

-- CreateIndex
CREATE INDEX "direct_messages_threadId_createdAt_idx" ON "direct_messages"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "direct_messages_threadId_clientMessageId_idx" ON "direct_messages"("threadId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blockerId_blockedId_key" ON "user_blocks"("blockerId", "blockedId");

-- AddForeignKey
ALTER TABLE "direct_threads" ADD CONSTRAINT "direct_threads_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_threads" ADD CONSTRAINT "direct_threads_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "direct_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
