import { appConfig, serverConfig } from "./app.config.js";

appConfig
  .listen(serverConfig.port, serverConfig.host)
  .then(() => {
    console.log(
      `[falling-platforms] server listening on ${serverConfig.host}:${serverConfig.port}`,
    );
  })
  .catch((error: unknown) => {
    console.error("[falling-platforms] failed to start server", error);
    process.exit(1);
  });
