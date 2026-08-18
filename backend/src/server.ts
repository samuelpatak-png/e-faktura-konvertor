import { app } from "./app";
import { env } from "./lib/env";

app.listen(env.PORT, () => {
  console.log(`Backend beží na http://localhost:${env.PORT}`);
});
