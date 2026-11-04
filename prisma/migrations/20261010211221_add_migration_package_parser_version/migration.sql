-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MigrationPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "parserVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MigrationPackage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MigrationPackage" ("checksum", "connectionId", "createdAt", "fileCount", "id", "name", "ownerId", "sourceProvider") SELECT "checksum", "connectionId", "createdAt", "fileCount", "id", "name", "ownerId", "sourceProvider" FROM "MigrationPackage";
DROP TABLE "MigrationPackage";
ALTER TABLE "new_MigrationPackage" RENAME TO "MigrationPackage";
CREATE INDEX "MigrationPackage_connectionId_idx" ON "MigrationPackage"("connectionId");
CREATE INDEX "MigrationPackage_ownerId_idx" ON "MigrationPackage"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
