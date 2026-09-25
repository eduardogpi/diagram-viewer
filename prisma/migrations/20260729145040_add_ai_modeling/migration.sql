-- CreateTable
CREATE TABLE "AiModelingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "diagramJson" TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[],"scopes":[]}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiModelingSession_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiModelingTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "operationsJson" TEXT,
    "diagramJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiModelingTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiModelingSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiModelingSession_connectionId_idx" ON "AiModelingSession"("connectionId");

-- CreateIndex
CREATE INDEX "AiModelingSession_ownerId_idx" ON "AiModelingSession"("ownerId");

-- CreateIndex
CREATE INDEX "AiModelingTurn_sessionId_order_idx" ON "AiModelingTurn"("sessionId", "order");
