import { beforeEach, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";

beforeEach(async () => {
  await prisma.partner.deleteMany();
  await prisma.priceListItem.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.sapiSkCredential.deleteMany();
  await prisma.companyProfile.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
