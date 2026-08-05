-- CreateEnum
CREATE TYPE "CalendarDayType" AS ENUM ('HOLIDAY', 'HALF_DAY');

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "holidays" ADD COLUMN     "type" "CalendarDayType" NOT NULL DEFAULT 'HOLIDAY';

-- CreateIndex
CREATE UNIQUE INDEX "departments_companyId_code_key" ON "departments"("companyId", "code");

