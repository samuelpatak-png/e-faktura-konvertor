// Must be the very first import in main.tsx, before App/render — see Sentry's React setup
// docs. Importing this file is always safe with no DSN configured: Sentry.init simply isn't
// called, so nothing is instrumented and nothing is sent anywhere.
import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn });
}
