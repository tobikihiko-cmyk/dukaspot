import { createIdentityRepository, createLedgerRepository } from "@dukaspot/database";
import { loadApiConfig } from "@dukaspot/config";
import { createNestApp } from "./nest-app.js";

const config = loadApiConfig();
const repository = createLedgerRepository({
  merchantId: config.merchantId,
  ...(config.databaseUrl ? { databaseUrl: config.databaseUrl } : {}),
  ...(config.dataFile ? { dataFile: config.dataFile } : {}),
});
const identityRepository = createIdentityRepository({
  ...(config.databaseUrl ? { databaseUrl: config.databaseUrl } : {}),
  ...(config.identityFile ? { identityFile: config.identityFile } : {}),
});
const app = await createNestApp({ repository, identityRepository, config });

await app.listen(config.port, config.host);

const url = await app.getUrl();
console.log(`Dukaspot API listening on ${url}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
