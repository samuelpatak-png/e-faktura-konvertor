import { Router } from "express";
import * as invoiceController from "../controllers/invoiceController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

const router = Router();
router.use(requireAuth);

router.post("/validate", asyncHandler(invoiceController.validateInvoice));
router.post("/generate", asyncHandler(invoiceController.generateInvoice));
router.get("/", asyncHandler(invoiceController.listInvoices));
router.get("/:id", asyncHandler(invoiceController.getInvoice));
router.get("/:id/download", asyncHandler(invoiceController.downloadInvoice));
router.post("/:id/send-sapi", asyncHandler(invoiceController.sendInvoiceViaSapi));

export default router;
