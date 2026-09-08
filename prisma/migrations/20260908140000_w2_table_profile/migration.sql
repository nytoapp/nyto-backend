-- W2 table profile used for matching. Collected at booking, not signup.
ALTER TABLE "users" ADD COLUMN "conversationStyle" TEXT;
ALTER TABLE "users" ADD COLUMN "tableOneLiner" TEXT;
ALTER TABLE "users" ADD COLUMN "datingIntent" TEXT;
