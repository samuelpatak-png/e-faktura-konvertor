import { app } from "./app";
import { env } from "./lib/env";
import { startReminderScheduler } from "./services/reminderScheduler";

app.listen(env.PORT, () => {
  console.log(`Backend beží na http://localhost:${env.PORT}`);
});

startReminderScheduler();
