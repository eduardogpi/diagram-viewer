-- CreateTable
CREATE TABLE "MigrationPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MigrationPackage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MigrationFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MigrationFile_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "MigrationPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MigrationSnapshotRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "migrationOrder" INTEGER NOT NULL,
    "migrationName" TEXT NOT NULL,
    "diagramJson" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MigrationSnapshotRow_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "MigrationPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MigrationPackage_connectionId_idx" ON "MigrationPackage"("connectionId");

-- CreateIndex
CREATE INDEX "MigrationPackage_ownerId_idx" ON "MigrationPackage"("ownerId");

-- CreateIndex
CREATE INDEX "MigrationFile_packageId_idx" ON "MigrationFile"("packageId");

-- CreateIndex
CREATE INDEX "MigrationSnapshotRow_packageId_migrationOrder_idx" ON "MigrationSnapshotRow"("packageId", "migrationOrder");
