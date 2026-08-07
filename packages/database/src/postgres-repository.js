import pg from "pg";
import { createSeedData } from "@dukaspot/core";
import { FileLedgerRepository, normalizeState, withAudit } from "./file-repository.js";
import { PostgresCommerceLedgerRepository } from "./commerce-repository.js";

const { Pool } = pg;

export class PostgresLedgerRepository extends FileLedgerRepository {
  constructor({ connectionString, merchantId = "pilot-merchant" } = {}) {
    super({ dataFile: "/tmp/dukaspot-unused.json", merchantId });
    if (!connectionString) {
      throw new Error("PostgresLedgerRepository requires connectionString");
    }
    this.pool = new Pool({
      connectionString,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    this.merchantId = merchantId;
  }

  async getLedger() {
    const state = await this._read();
    return state;
  }

  forMerchant(merchantId) {
    return new PostgresCommerceLedgerRepository({
      pool: this.pool,
      merchantId,
    });
  }

  async replaceLedger(nextState, action = "Replaced ledger state") {
    const state = withAudit(normalizeState(nextState), action);
    await this._write(state);
    return { state, message: action };
  }

  async resetDemo() {
    const state = withAudit(createSeedData(), "Reset demo ledger");
    await this._write(state);
    return { state, message: "Demo data reset" };
  }

  async _read() {
    const result = await this.pool.query(
      "select state from ledger_states where merchant_id = $1",
      [this.merchantId]
    );

    if (result.rowCount) return normalizeState(result.rows[0].state);

    const seeded = withAudit(createSeedData(), "Initialized demo ledger");
    await this._write(seeded);
    return seeded;
  }

  async _write(state) {
    await this.pool.query(
      `
        insert into ledger_states (merchant_id, state, updated_at)
        values ($1, $2::jsonb, now())
        on conflict (merchant_id)
        do update set state = excluded.state, updated_at = now()
      `,
      [this.merchantId, JSON.stringify(normalizeState(state))]
    );
  }

  async _mutate(action, updater) {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      const result = await this._runMutation(action, updater, {
        read: () => this._readForUpdate(client),
        write: (state) => this._writeWithClient(client, state),
      });
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async _readForUpdate(client) {
    const seeded = withAudit(createSeedData(), "Initialized demo ledger");
    await client.query(
      `
        insert into ledger_states (merchant_id, state, updated_at)
        values ($1, $2::jsonb, now())
        on conflict (merchant_id) do nothing
      `,
      [this.merchantId, JSON.stringify(normalizeState(seeded))]
    );

    const result = await client.query(
      "select state from ledger_states where merchant_id = $1 for update",
      [this.merchantId]
    );

    if (result.rowCount) return normalizeState(result.rows[0].state);
    throw new Error("Unable to initialize ledger state");
  }

  async _writeWithClient(client, state) {
    await client.query(
      `
        insert into ledger_states (merchant_id, state, updated_at)
        values ($1, $2::jsonb, now())
        on conflict (merchant_id)
        do update set state = excluded.state, updated_at = now()
      `,
      [this.merchantId, JSON.stringify(normalizeState(state))]
    );
  }
}
