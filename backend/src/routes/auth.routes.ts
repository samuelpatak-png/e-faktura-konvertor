import { Router } from "express";
import * as authController from "../controllers/authController";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { authRateLimiter } from "../middleware/rateLimit";

const router = Router();

router.post("/register", authRateLimiter, asyncHandler(authController.register));
router.post("/login", authRateLimiter, asyncHandler(authController.login));
router.post("/logout", authController.logout);
router.get("/me", requireAuth, asyncHandler(authController.me));

router.post("/request-password-reset", authRateLimiter, asyncHandler(authController.requestPasswordReset));
router.post("/reset-password", authRateLimiter, asyncHandler(authController.resetPassword));
router.post("/request-verification", requireAuth, authRateLimiter, asyncHandler(authController.requestVerification));
router.post("/verify-email", authRateLimiter, asyncHandler(authController.verifyEmail));

export default router;
