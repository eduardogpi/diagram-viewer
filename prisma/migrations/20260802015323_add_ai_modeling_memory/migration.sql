-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiModelingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    "diagramJson" TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[],"scopes":[]}',
    "checkpointOrder" INTEGER,
    "memoryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "memoryProjectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiModelingSession_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AiModelingSession" ("checkpointOrder", "connectionId", "createdAt", "diagramJson", "id", "model", "name", "ownerId", "provider", "updatedAt") SELECT "checkpointOrder", "connectionId", "createdAt", "diagramJson", "id", "model", "name", "ownerId", "provider", "updatedAt" FROM "AiModelingSession";
DROP TABLE "AiModelingSession";
ALTER TABLE "new_AiModelingSession" RENAME TO "AiModelingSession";
CREATE INDEX "AiModelingSession_connectionId_idx" ON "AiModelingSession"("connectionId");
CREATE INDEX "AiModelingSession_ownerId_idx" ON "AiModelingSession"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
