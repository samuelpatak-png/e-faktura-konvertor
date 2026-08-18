import { Router } from "express";
import * as companyController from "../controllers/companyController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

const router = Router();
router.use(requireAuth);

router.get("/profile", asyncHandler(companyController.getCompanyProfile));
router.put("/profile", asyncHandler(companyController.upsertCompanyProfile));

router.get("/sapi-credentials", asyncHandler(companyController.getSapiSkStatus));
router.put("/sapi-credentials", asyncHandler(companyController.setSapiSkCredential));
router.patch("/sapi-credentials/mode", asyncHandler(companyController.setSapiSkMode));
router.delete("/sapi-credentials", asyncHandler(companyController.deleteSapiSkCredential));

export default router;
