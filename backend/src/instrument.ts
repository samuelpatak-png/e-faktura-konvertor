// Must be the first thing imported by server.ts (before ./app) — Sentry's Node SDK instruments
// other modules as they're `require`d, so it has to run before anything else pulls in express,
// http, etc. Importing this file is always safe with no DSN set: Sentry.init simply isn't
// called, so nothing is instrumented and nothing is sent anywhere.
import * as Sentry from "@sentry/node";
import { env } from "./lib/env";

if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN });
}
