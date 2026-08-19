-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "fullName" SET DEFAULT '',
ALTER COLUMN "dateOfBirth" DROP NOT NULL;
