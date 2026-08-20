import { Router } from "express";
import * as partnerController from "../controllers/partnerController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(partnerController.listPartners));
router.post("/", asyncHandler(partnerController.createPartner));
router.get("/registry/:ico", asyncHandler(partnerController.lookupPartnerByIco));
router.get("/:id", asyncHandler(partnerController.getPartner));
router.put("/:id", asyncHandler(partnerController.updatePartner));
router.delete("/:id", asyncHandler(partnerController.deletePartner));

export default router;
