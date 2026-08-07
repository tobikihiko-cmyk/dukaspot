import { createLedgerRepository } from "@dukaspot/database";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const repository = createLedgerRepository(config);
const app = createApp({ repository, config });

const server = app.listen(config.port, config.host, () => {
  console.log(`Dukaspot API listening on http://${config.host}:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
