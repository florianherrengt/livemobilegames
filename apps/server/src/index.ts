import { appConfig } from "./app.config.js";

const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? "0.0.0.0";

appConfig
  .listen(port, host)
  .then(() => {
    console.log(`[falling-platforms] server listening on ${host}:${port}`);
  })
  .catch((error: unknown) => {
    console.error("[falling-platforms] failed to start server", error);
    process.exit(1);
  });
