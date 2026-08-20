import { Router } from "express";
import * as priceListController from "../controllers/priceListController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

const router = Router();
router.use(requireAuth);

router.get("/", asyncHandler(priceListController.listPriceListItems));
router.post("/", asyncHandler(priceListController.createPriceListItem));
router.get("/:id", asyncHandler(priceListController.getPriceListItem));
router.put("/:id", asyncHandler(priceListController.updatePriceListItem));
router.delete("/:id", asyncHandler(priceListController.deletePriceListItem));

export default router;
