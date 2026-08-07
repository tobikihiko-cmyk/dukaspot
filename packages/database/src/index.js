import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileLedgerRepository } from "./file-repository.js";
import {
  FileIdentityRepository,
  PostgresIdentityRepository,
} from "./identity-repository.js";
import { PostgresLedgerRepository } from "./postgres-repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_FILE = path.resolve(
  __dirname,
  "../../../data/dukaspot.dev.json"
);
const DEFAULT_IDENTITY_FILE = path.resolve(
  __dirname,
  "../../../data/dukaspot.identity.dev.json"
);

export function createLedgerRepository(options = {}) {
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
  const merchantId =
    options.merchantId || process.env.DUKASPOT_MERCHANT_ID || "pilot-merchant";

  if (databaseUrl) {
    return new PostgresLedgerRepository({
      connectionString: databaseUrl,
      merchantId,
    });
  }

  return new FileLedgerRepository({
    dataFile: options.dataFile || process.env.DUKASPOT_DATA_FILE || DEFAULT_DATA_FILE,
    merchantId,
  });
}

export function createIdentityRepository(options = {}) {
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;

  if (databaseUrl) {
    return new PostgresIdentityRepository({
      connectionString: databaseUrl,
    });
  }

  return new FileIdentityRepository({
    dataFile:
      options.identityFile ||
      process.env.DUKASPOT_IDENTITY_FILE ||
      DEFAULT_IDENTITY_FILE,
  });
}

export { FileLedgerRepository } from "./file-repository.js";
export { PostgresCommerceLedgerRepository } from "./commerce-repository.js";
export {
  FileIdentityRepository,
  PostgresIdentityRepository,
} from "./identity-repository.js";
export { PostgresLedgerRepository } from "./postgres-repository.js";
