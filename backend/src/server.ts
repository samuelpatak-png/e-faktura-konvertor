import "./instrument"; // must be first — see instrument.ts
import { app } from "./app";
import { env } from "./lib/env";
import { startReminderScheduler } from "./services/reminderScheduler";

app.listen(env.PORT, () => {
  console.log(`Backend beží na http://localhost:${env.PORT}`);
});

startReminderScheduler();
