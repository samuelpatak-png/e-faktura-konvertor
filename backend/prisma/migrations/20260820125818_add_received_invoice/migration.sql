-- CreateTable
CREATE TABLE "ReceivedInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" TEXT NOT NULL,
    "dueDate" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "supplierName" TEXT NOT NULL,
    "supplierIco" TEXT,
    "supplierDic" TEXT,
    "supplierIcDph" TEXT,
    "supplierStreet" TEXT,
    "supplierCity" TEXT,
    "supplierPostalCode" TEXT,
    "supplierCountry" TEXT,
    "customerName" TEXT,
    "customerDic" TEXT,
    "netAmountCents" INTEGER NOT NULL,
    "taxAmountCents" INTEGER NOT NULL,
    "grossAmountCents" INTEGER NOT NULL,
    "linesJson" TEXT NOT NULL,
    "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
    "paidAt" DATETIME,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "rawXml" TEXT NOT NULL,
    "fileName" TEXT,
    "ourErrors" TEXT NOT NULL,
    "ourWarnings" TEXT NOT NULL,
    "kositAcceptable" BOOLEAN,
    "kositMessages" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReceivedInvoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReceivedInvoice_userId_idx" ON "ReceivedInvoice"("userId");
