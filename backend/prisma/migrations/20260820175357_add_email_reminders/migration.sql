-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "customerEmail" TEXT;

-- CreateTable
CREATE TABLE "EmailSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpUser" TEXT NOT NULL,
    "encryptedSmtpPassword" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "subjectTemplate" TEXT NOT NULL DEFAULT 'Faktúra {{invoiceNumber}}',
    "bodyTemplate" TEXT NOT NULL DEFAULT 'Dobrý deň,

v prílohe posielame faktúru č. {{invoiceNumber}} na sumu {{amount}} so splatnosťou {{dueDate}}.

S pozdravom',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReminderSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "firstReminderDays" INTEGER NOT NULL DEFAULT 7,
    "reminderCount" INTEGER NOT NULL DEFAULT 3,
    "intervalDays" INTEGER NOT NULL DEFAULT 7,
    "subjectTemplate" TEXT NOT NULL DEFAULT 'Upomienka: Faktúra {{invoiceNumber}} po splatnosti',
    "bodyTemplate" TEXT NOT NULL DEFAULT 'Dobrý deň,

pripomíname, že faktúra č. {{invoiceNumber}} na sumu {{amount}} so splatnosťou {{dueDate}} nebola doteraz uhradená. Prosíme o úhradu v čo najkratšom čase.

S pozdravom',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReminderSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SentEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reminderNumber" INTEGER,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SentEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SentEmail_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSettings_userId_key" ON "EmailSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderSettings_userId_key" ON "ReminderSettings"("userId");

-- CreateIndex
CREATE INDEX "SentEmail_invoiceId_idx" ON "SentEmail"("invoiceId");

-- CreateIndex
CREATE INDEX "SentEmail_userId_idx" ON "SentEmail"("userId");
