import { Router } from "express";
import multer from "multer";
import * as receivedInvoiceController from "../controllers/receivedInvoiceController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

// 5MB — matches ublParser.ts's own internal ceiling (belt and suspenders: reject an oversized
// upload before it even reaches the parser). Browsers send inconsistent mimetypes for .xml
// (text/xml, application/xml, sometimes text/plain) — filter on extension instead.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.originalname.toLowerCase().endsWith(".xml"));
  },
});

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(receivedInvoiceController.listReceivedInvoices));
router.post("/upload", upload.single("file"), asyncHandler(receivedInvoiceController.uploadReceivedInvoice));
router.get("/:id", asyncHandler(receivedInvoiceController.getReceivedInvoice));
router.get("/:id/download", asyncHandler(receivedInvoiceController.downloadReceivedInvoiceXml));
router.post("/:id/payments", asyncHandler(receivedInvoiceController.recordReceivedInvoicePayment));
router.delete("/:id", asyncHandler(receivedInvoiceController.deleteReceivedInvoice));

export default router;
