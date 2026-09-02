ALTER TABLE "direct_messages" DROP CONSTRAINT "direct_messages_senderId_fkey";
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "direct_threads" DROP CONSTRAINT "direct_threads_userLowId_fkey";
ALTER TABLE "direct_threads" ADD CONSTRAINT "direct_threads_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "direct_threads" DROP CONSTRAINT "direct_threads_userHighId_fkey";
ALTER TABLE "direct_threads" ADD CONSTRAINT "direct_threads_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
