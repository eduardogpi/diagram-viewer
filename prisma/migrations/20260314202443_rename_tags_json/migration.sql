/*
  Warnings:

  - You are about to drop the column `contextJson` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `edgesJson` on the `LayoutSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `nodesJson` on the `LayoutSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `settingsJson` on the `LayoutSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `favoriteTabsJson` on the `WorkspacePreference` table. All the data in the column will be lost.
  - Added the required column `edges` to the `LayoutSnapshot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nodes` to the `LayoutSnapshot` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT,
    "context" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AuditLog" ("action", "connectionId", "createdAt", "id", "userId") SELECT "action", "connectionId", "createdAt", "id", "userId" FROM "AuditLog";
DROP TABLE "AuditLog";
ALTER TABLE "new_AuditLog" RENAME TO "AuditLog";
CREATE INDEX "AuditLog_connectionId_idx" ON "AuditLog"("connectionId");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE TABLE "new_LayoutSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "nodes" TEXT NOT NULL,
    "edges" TEXT NOT NULL,
    "settings" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LayoutSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LayoutSnapshot" ("checksum", "connectionId", "createdAt", "createdBy", "id", "name") SELECT "checksum", "connectionId", "createdAt", "createdBy", "id", "name" FROM "LayoutSnapshot";
DROP TABLE "LayoutSnapshot";
ALTER TABLE "new_LayoutSnapshot" RENAME TO "LayoutSnapshot";
CREATE INDEX "LayoutSnapshot_connectionId_checksum_idx" ON "LayoutSnapshot"("connectionId", "checksum");
CREATE TABLE "new_WorkspacePreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "theme" TEXT,
    "favoriteTabs" TEXT NOT NULL DEFAULT '[]',
    "scopeDepth" INTEGER NOT NULL DEFAULT 2,
    "minimap" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspacePreference_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WorkspacePreference" ("connectionId", "createdAt", "id", "minimap", "scopeDepth", "theme", "updatedAt", "userId") SELECT "connectionId", "createdAt", "id", "minimap", "scopeDepth", "theme", "updatedAt", "userId" FROM "WorkspacePreference";
DROP TABLE "WorkspacePreference";
ALTER TABLE "new_WorkspacePreference" RENAME TO "WorkspacePreference";
CREATE UNIQUE INDEX "WorkspacePreference_userId_connectionId_key" ON "WorkspacePreference"("userId", "connectionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
