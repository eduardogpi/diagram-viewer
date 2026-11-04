-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MigrationSnapshotRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "migrationOrder" INTEGER NOT NULL,
    "migrationName" TEXT NOT NULL,
    "diagramJson" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "statsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MigrationSnapshotRow_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "MigrationPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MigrationSnapshotRow" ("createdAt", "diagramJson", "id", "migrationName", "migrationOrder", "packageId", "warningsJson") SELECT "createdAt", "diagramJson", "id", "migrationName", "migrationOrder", "packageId", "warningsJson" FROM "MigrationSnapshotRow";
DROP TABLE "MigrationSnapshotRow";
ALTER TABLE "new_MigrationSnapshotRow" RENAME TO "MigrationSnapshotRow";
CREATE INDEX "MigrationSnapshotRow_packageId_migrationOrder_idx" ON "MigrationSnapshotRow"("packageId", "migrationOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
