import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  PostgresIdentityRepository,
  PostgresLedgerRepository,
} from "../src/index.js";

const connectionString = process.env.DUKASPOT_POSTGRES_TEST_URL;

if (!connectionString) {
  console.log("SKIP postgres commerce repository test; DUKASPOT_POSTGRES_TEST_URL is not set");
  process.exit(0);
}

await runMigrations(connectionString);

const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const identityRepository = new PostgresIdentityRepository({ connectionString });
const ledgerRoot = new PostgresLedgerRepository({
  connectionString,
  merchantId: "legacy-pilot",
});

const alice = await identityRepository.createOwnerAccount({
  email: `alice-${unique}@example.com`,
  name: "Alice Owner",
  passwordHash: "hash_alice",
  merchantName: `Alice Threads ${unique}`,
});
const bob = await identityRepository.createOwnerAccount({
  email: `bob-${unique}@example.com`,
  name: "Bob Owner",
  passwordHash: "hash_bob",
  merchantName: `Bob Beauty ${unique}`,
});

try {
  const aliceLedger = ledgerRoot.forMerchant(alice.merchant.id);
  const initial = await aliceLedger.getLedger();
  assert.equal(initial.orders.length, 5);
  const initialTrialBalance = await aliceLedger.getTrialBalance();
  assert.equal(initialTrialBalance.balanced, true);
  assert.ok(initialTrialBalance.totalDebits > 0);

  const created = await aliceLedger.runIdempotent({
    key: "create-postgres-order",
    requestHash: "hash_a",
    method: "POST",
    path: "/api/orders",
    operation: async () => ({
      statusCode: 201,
      body: await aliceLedger.createOrder({
        id: "ord_pg_idempotent",
        createdAt: new Date().toISOString(),
        customerName: "Postgres Buyer",
        phone: "+254712444123",
        productName: "Glow serum",
        variant: "30ml",
        quantity: 1,
        unitPrice: 950,
        unitCost: 450,
        deliveryFee: 100,
        discount: 0,
        location: "Nairobi",
        source: "WhatsApp",
        agent: "Amina",
        stage: "confirmed",
        paymentStatus: "unpaid",
        notes: "",
        lastFollowUpAt: "",
      }),
    }),
  });
  assert.equal(created.statusCode, 201);

  const replayed = await aliceLedger.runIdempotent({
    key: "create-postgres-order",
    requestHash: "hash_a",
    method: "POST",
    path: "/api/orders",
    operation: async () => {
      throw new Error("Postgres idempotency replay should not rerun operation");
    },
  });
  assert.equal(replayed.replayed, true);
  assert.equal(
    replayed.body.state.orders.filter((order) => order.id === "ord_pg_idempotent").length,
    1
  );

  await assert.rejects(
    () =>
      aliceLedger.runIdempotent({
        key: "create-postgres-order",
        requestHash: "hash_b",
        method: "POST",
        path: "/api/orders",
        operation: async () => ({ statusCode: 200, body: {} }),
      }),
    { code: "CONFLICT", statusCode: 409 }
  );

  const imported = await aliceLedger.importPayments(
    [
      "Date,Receipt,Payer,Phone,Paid In,Details",
      "2026-08-06T10:30:00+03:00,QH80PG001,Postgres Buyer,0712444123,1050,Received from Postgres Buyer 0712444123",
    ].join("\n")
  );
  assert.equal(imported.imported, 1);

  const matched = await aliceLedger.matchPayment("pay_QH80PG001", "ord_pg_idempotent");
  const payment = matched.state.payments.find((entry) => entry.id === "pay_QH80PG001");
  assert.equal(payment.orderId, "ord_pg_idempotent");

  const matchedTrialBalance = await aliceLedger.getTrialBalance();
  assert.equal(matchedTrialBalance.balanced, true);
  assert.equal(matchedTrialBalance.totalDebits, matchedTrialBalance.totalCredits);
  assert.ok(matchedTrialBalance.totalDebits > initialTrialBalance.totalDebits);
  const accountCodes = new Set(matchedTrialBalance.accounts.map((account) => account.accountCode));
  assert.ok(accountCodes.has("1000_MPESA_CASH"));
  assert.ok(accountCodes.has("1100_ACCOUNTS_RECEIVABLE"));
  assert.ok(accountCodes.has("4000_SALES_REVENUE"));
  assert.ok(accountCodes.has("5000_COST_OF_GOODS_SOLD"));

  await aliceLedger.unmatchPayment("pay_QH80PG001");
  const unmatchedTrialBalance = await aliceLedger.getTrialBalance();
  assert.equal(unmatchedTrialBalance.balanced, true);

  await aliceLedger.matchPayment("pay_QH80PG001", "ord_pg_idempotent");
  const rematchedTrialBalance = await aliceLedger.getTrialBalance();
  assert.equal(rematchedTrialBalance.balanced, true);
  assert.equal(rematchedTrialBalance.totalDebits, matchedTrialBalance.totalDebits);

  await aliceLedger.updateOrder("ord_pg_idempotent", { stage: "cancelled" });
  const cancelledTrialBalance = await aliceLedger.getTrialBalance();
  assert.equal(cancelledTrialBalance.balanced, true);

  await aliceLedger.updateOrder("ord_pg_idempotent", { stage: "confirmed" });
  const reconfirmedTrialBalance = await aliceLedger.getTrialBalance();
  assert.equal(reconfirmedTrialBalance.balanced, true);
  assert.equal(reconfirmedTrialBalance.totalDebits, rematchedTrialBalance.totalDebits);

  const unbalancedEntries = await ledgerRoot.pool.query(
    `
      select e.id
      from journal_entries e
      join journal_lines l on l.journal_entry_id = e.id and l.merchant_id = e.merchant_id
      where e.merchant_id = $1
      group by e.id
      having sum(l.debit_minor) <> sum(l.credit_minor)
    `,
    [alice.merchant.id]
  );
  assert.equal(unbalancedEntries.rowCount, 0);

  const bobLedger = ledgerRoot.forMerchant(bob.merchant.id);
  const bobState = await bobLedger.getLedger();
  assert.equal(bobState.orders.some((order) => order.id === "ord_pg_idempotent"), false);
  const bobTrialBalance = await bobLedger.getTrialBalance();
  assert.equal(bobTrialBalance.balanced, true);

  console.log("PASS postgres commerce repository normalized persistence workflow");
} finally {
  await ledgerRoot.pool.query("delete from merchants where id in ($1, $2)", [
    alice.merchant.id,
    bob.merchant.id,
  ]);
  await ledgerRoot.pool.query("delete from users where email in ($1, $2)", [
    alice.user.email,
    bob.user.email,
  ]);
  await ledgerRoot.pool.end();
  await identityRepository.pool.end();
}

async function runMigrations(url) {
  const pool = new pg.Pool({ connectionString: url });
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(__dirname, "../migrations");

  try {
    await pool.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const entries = (await fs.readdir(migrationsDir))
      .filter((entry) => entry.endsWith(".sql"))
      .sort();

    for (const entry of entries) {
      const applied = await pool.query("select 1 from schema_migrations where id = $1", [
        entry,
      ]);
      if (applied.rowCount) continue;

      const sql = await fs.readFile(path.join(migrationsDir, entry), "utf8");
      await pool.query("begin");
      try {
        await pool.query(sql);
        await pool.query("insert into schema_migrations (id) values ($1)", [entry]);
        await pool.query("commit");
      } catch (error) {
        await pool.query("rollback");
        throw error;
      }
    }
  } finally {
    await pool.end();
  }
}
