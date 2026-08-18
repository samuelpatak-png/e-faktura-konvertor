import { Router } from "express";
import multer from "multer";
import * as pdfController from "../controllers/pdfController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === "application/pdf");
  },
});

const router = Router();
router.use(requireAuth);

router.post("/parse", upload.single("file"), asyncHandler(pdfController.parsePdf));

export default router;
