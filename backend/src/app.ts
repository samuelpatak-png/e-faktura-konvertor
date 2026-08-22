import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";
import { env } from "./lib/env";
import authRoutes from "./routes/auth.routes";
import companyRoutes from "./routes/company.routes";
import invoiceRoutes from "./routes/invoice.routes";
import pdfRoutes from "./routes/pdf.routes";
import partnerRoutes from "./routes/partner.routes";
import priceListRoutes from "./routes/priceList.routes";
import receivedInvoiceRoutes from "./routes/receivedInvoice.routes";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/company", companyRoutes);
app.use("/api/invoice", invoiceRoutes);
app.use("/api/pdf", pdfRoutes);
app.use("/api/partner", partnerRoutes);
app.use("/api/price-list", priceListRoutes);
app.use("/api/received-invoice", receivedInvoiceRoutes);

// After every route, before the final error handler — a no-op chain when SENTRY_DSN isn't set
// (instrument.ts never called Sentry.init, so this middleware has nothing to report to).
Sentry.setupExpressErrorHandler(app);

app.use(errorHandler);
