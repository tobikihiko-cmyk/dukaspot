import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileLedgerRepository } from "../src/index.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dukaspot-db-"));
const repository = new FileLedgerRepository({
  dataFile: path.join(tempDir, "ledger.json"),
});

const initial = await repository.getLedger();
assert.equal(initial.orders.length, 5);

const created = await repository.createOrder({
  id: "ord_test",
  createdAt: new Date().toISOString(),
  customerName: "Launch Buyer",
  phone: "+254712000000",
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
});
assert.ok(created.state.orders.some((order) => order.id === "ord_test"));

const imported = await repository.importPayments(
  [
    "Date,Receipt,Payer,Phone,Paid In,Details",
    "2026-08-06T10:30:00+03:00,QH80LAUNCH,Launch Buyer,0712000000,1050,Received from Launch Buyer 0712000000",
  ].join("\n")
);
assert.equal(imported.imported, 1);

const matched = await repository.matchPayment("pay_QH80LAUNCH", "ord_test");
const payment = matched.state.payments.find((entry) => entry.id === "pay_QH80LAUNCH");
assert.equal(payment.orderId, "ord_test");
assert.equal(payment.status, "matched");

await Promise.all(
  Array.from({ length: 5 }, (_, index) =>
    repository.createOrder({
      id: `ord_parallel_${index}`,
      createdAt: new Date().toISOString(),
      customerName: `Parallel Buyer ${index}`,
      phone: `+25471200000${index}`,
      productName: "Parallel serum",
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
    })
  )
);
const concurrent = await repository.getLedger();
assert.equal(
  concurrent.orders.filter((order) => order.id.startsWith("ord_parallel_")).length,
  5
);

const duplicateCsv = [
  "Date,Receipt,Payer,Phone,Paid In,Details",
  "2026-08-06T10:30:00+03:00,QH80RACE,Launch Buyer,0712000000,1050,Received from Launch Buyer 0712000000",
].join("\n");
const duplicateImports = await Promise.all([
  repository.importPayments(duplicateCsv),
  repository.importPayments(duplicateCsv),
]);
assert.equal(
  duplicateImports.reduce((sum, result) => sum + result.imported, 0),
  1
);
const deduped = await repository.getLedger();
assert.equal(deduped.payments.filter((entry) => entry.receipt === "QH80RACE").length, 1);

const firstIdempotent = await repository.runIdempotent({
  key: "idem-create-order",
  requestHash: "hash_a",
  operation: async () => ({
    statusCode: 201,
    body: await repository.createOrder({
      id: "ord_idempotent",
      createdAt: new Date().toISOString(),
      customerName: "Idempotent Buyer",
      phone: "+254712000099",
      productName: "Stable serum",
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
assert.equal(firstIdempotent.statusCode, 201);

const replayedIdempotent = await repository.runIdempotent({
  key: "idem-create-order",
  requestHash: "hash_a",
  operation: async () => {
    throw new Error("Idempotency replay should not rerun operation");
  },
});
assert.equal(replayedIdempotent.replayed, true);
assert.equal(replayedIdempotent.body.state.orders.filter((order) => order.id === "ord_idempotent").length, 1);

await assert.rejects(
  () =>
    repository.runIdempotent({
      key: "idem-create-order",
      requestHash: "hash_b",
      operation: async () => ({ statusCode: 200, body: {} }),
    }),
  { code: "CONFLICT", statusCode: 409 }
);

console.log("PASS file repository persistence workflow");
