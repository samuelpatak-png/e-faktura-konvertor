import { Router } from "express";
import multer from "multer";
import * as companyController from "../controllers/companyController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

// 2MB per image is generous for a logo/stamp/signature PNG or JPEG while still bounding
// worst-case row size (stored as base64 in the DB — see schema comment).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === "image/png" || file.mimetype === "image/jpeg");
  },
});

const router = Router();
router.use(requireAuth);

router.get("/profile", asyncHandler(companyController.getCompanyProfile));
router.put("/profile", asyncHandler(companyController.upsertCompanyProfile));

router.get("/branding/:asset", asyncHandler(companyController.getBrandingAsset));
router.put(
  "/branding",
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "stamp", maxCount: 1 },
    { name: "signature", maxCount: 1 },
  ]),
  asyncHandler(companyController.updateBranding)
);
router.delete("/branding/:asset", asyncHandler(companyController.removeBrandingAsset));

router.get("/sapi-credentials", asyncHandler(companyController.getSapiSkStatus));
router.put("/sapi-credentials", asyncHandler(companyController.setSapiSkCredential));
router.patch("/sapi-credentials/mode", asyncHandler(companyController.setSapiSkMode));
router.delete("/sapi-credentials", asyncHandler(companyController.deleteSapiSkCredential));

router.get("/email-settings", asyncHandler(companyController.getEmailSettings));
router.put("/email-settings", asyncHandler(companyController.saveEmailSettings));
router.delete("/email-settings", asyncHandler(companyController.deleteEmailSettings));

router.get("/reminder-settings", asyncHandler(companyController.getReminderSettings));
router.put("/reminder-settings", asyncHandler(companyController.saveReminderSettings));

export default router;
