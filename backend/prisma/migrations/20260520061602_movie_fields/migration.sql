/*
  Warnings:

  - You are about to drop the column `posterUrl` on the `Movie` table. All the data in the column will be lost.
  - You are about to drop the column `venue` on the `Movie` table. All the data in the column will be lost.
  - Added the required column `director` to the `Movie` table without a default value. This is not possible if the table is not empty.
  - Added the required column `language` to the `Movie` table without a default value. This is not possible if the table is not empty.
  - Added the required column `runtimeMin` to the `Movie` table without a default value. This is not possible if the table is not empty.
  - Added the required column `venueAddress` to the `Movie` table without a default value. This is not possible if the table is not empty.
  - Added the required column `venueName` to the `Movie` table without a default value. This is not possible if the table is not empty.
  - Added the required column `year` to the `Movie` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Movie" DROP COLUMN "posterUrl",
DROP COLUMN "venue",
ADD COLUMN     "director" TEXT NOT NULL,
ADD COLUMN     "language" TEXT NOT NULL,
ADD COLUMN     "runtimeMin" INTEGER NOT NULL,
ADD COLUMN     "venueAddress" TEXT NOT NULL,
ADD COLUMN     "venueName" TEXT NOT NULL,
ADD COLUMN     "year" INTEGER NOT NULL;
