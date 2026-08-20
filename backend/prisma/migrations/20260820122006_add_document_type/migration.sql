-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "buyerReference" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "supplierName" TEXT NOT NULL,
    "supplierIco" TEXT NOT NULL,
    "supplierDic" TEXT NOT NULL,
    "supplierIcDph" TEXT,
    "supplierStreet" TEXT NOT NULL,
    "supplierCity" TEXT NOT NULL,
    "supplierPostalCode" TEXT NOT NULL,
    "supplierCountry" TEXT NOT NULL,
    "supplierIban" TEXT NOT NULL,
    "supplierBic" TEXT,
    "customerName" TEXT NOT NULL,
    "customerIco" TEXT,
    "customerDic" TEXT NOT NULL,
    "customerIcDph" TEXT,
    "customerStreet" TEXT NOT NULL,
    "customerCity" TEXT NOT NULL,
    "customerPostalCode" TEXT NOT NULL,
    "customerCountry" TEXT NOT NULL DEFAULT 'SK',
    "netAmountCents" INTEGER NOT NULL,
    "taxAmountCents" INTEGER NOT NULL,
    "grossAmountCents" INTEGER NOT NULL,
    "xml" TEXT,
    "sapiProviderDocumentId" TEXT,
    "sentAt" DATETIME,
    "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
    "paidAt" DATETIME,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "documentType" TEXT NOT NULL DEFAULT 'INVOICE',
    "originalInvoiceId" TEXT,
    "prepaidAmountCents" INTEGER,
    "prepaidReference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invoice_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("buyerReference", "createdAt", "currency", "customerCity", "customerCountry", "customerDic", "customerIcDph", "customerIco", "customerName", "customerPostalCode", "customerStreet", "dueDate", "grossAmountCents", "id", "issueDate", "netAmountCents", "number", "paidAmountCents", "paidAt", "paymentStatus", "sapiProviderDocumentId", "sentAt", "status", "supplierBic", "supplierCity", "supplierCountry", "supplierDic", "supplierIban", "supplierIcDph", "supplierIco", "supplierName", "supplierPostalCode", "supplierStreet", "taxAmountCents", "updatedAt", "userId", "xml") SELECT "buyerReference", "createdAt", "currency", "customerCity", "customerCountry", "customerDic", "customerIcDph", "customerIco", "customerName", "customerPostalCode", "customerStreet", "dueDate", "grossAmountCents", "id", "issueDate", "netAmountCents", "number", "paidAmountCents", "paidAt", "paymentStatus", "sapiProviderDocumentId", "sentAt", "status", "supplierBic", "supplierCity", "supplierCountry", "supplierDic", "supplierIban", "supplierIcDph", "supplierIco", "supplierName", "supplierPostalCode", "supplierStreet", "taxAmountCents", "updatedAt", "userId", "xml" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE INDEX "Invoice_originalInvoiceId_idx" ON "Invoice"("originalInvoiceId");
CREATE UNIQUE INDEX "Invoice_userId_number_key" ON "Invoice"("userId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
