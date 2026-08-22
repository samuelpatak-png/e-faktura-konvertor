import rateLimit from "express-rate-limit";

// Keyed by IP (the library's default) — deliberately not per-email, so a single attacker can't
// dodge the limit by rotating target emails. Applied only to the specific auth endpoints that
// take a credential/token (login, register, password-reset request+complete, email-verification
// request+complete) — never to /auth/me or /logout, which aren't brute-force targets and are
// called far more often during ordinary use (e.g. /me on every page load).
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Príliš veľa pokusov, skús to znova o chvíľu." },
});
