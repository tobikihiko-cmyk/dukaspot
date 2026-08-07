import assert from "node:assert/strict";
import {
  buildReconciliation,
  createSeedData,
  dailyOwnerReport,
  deriveOrder,
  findDuplicatePayments,
  getCustomerProfiles,
  getInventoryRows,
  getSummary,
  matchedPaymentsForOrder,
  normalizePhone,
  orderGrossProfit,
  orderTotal,
  parseMpesaCsv,
} from "../src/ledger.js";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("normalizes Kenyan mobile numbers", () => {
  assert.equal(normalizePhone("0712345678"), "+254712345678");
  assert.equal(normalizePhone("+254 701 555 901"), "+254701555901");
  assert.equal(normalizePhone("100991881"), "+254100991881");
});

test("parses M-PESA CSV rows", () => {
  const rows = parseMpesaCsv(
    [
      "Date,Receipt,Payer,Phone,Paid In,Details",
      "2026-08-06T10:30:00+03:00,QH80NEW001,Jane Njeri,0712345678,2650,Received from Jane Njeri 0712345678",
    ].join("\n")
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 2650);
  assert.equal(rows[0].phone, "+254712345678");
});

test("suggests an exact payment match", () => {
  const state = createSeedData(new Date("2026-08-06T12:00:00+03:00"));
  const reconciliation = buildReconciliation(state.orders, state.payments);
  const janePayment = state.payments.find(
    (payment) => payment.receipt === "QH80ABC123"
  );
  const suggestion = reconciliation.suggestions[janePayment.id][0];

  assert.equal(suggestion.orderId, "ord_1001");
  assert.ok(suggestion.score >= 80);
});

test("derives partial balances from matched deposits", () => {
  const state = createSeedData(new Date("2026-08-06T12:00:00+03:00"));
  const order = state.orders.find((entry) => entry.id === "ord_1003");
  const derived = deriveOrder(order, state.payments);

  assert.equal(derived.computedPaymentStatus, "partial");
  assert.equal(derived.balance, 1400);
});

test("characterizes pilot order totals and gross profit", () => {
  const order = {
    quantity: 2,
    unitPrice: 2400,
    unitCost: 1200,
    discount: 300,
    deliveryFee: 350,
  };

  assert.equal(orderTotal(order), 4850);
  assert.equal(orderGrossProfit(order), 2100);
});

test("characterizes matched payment exclusions for non-sales classes", () => {
  const payments = [
    {
      id: "pay_sale",
      orderId: "ord_1",
      amount: 1200,
      status: "matched",
      classification: "product_sale",
    },
    {
      id: "pay_owner",
      orderId: "ord_1",
      amount: 5000,
      status: "matched",
      classification: "owner_deposit",
    },
    {
      id: "pay_duplicate",
      orderId: "ord_1",
      amount: 1200,
      status: "duplicate",
      classification: "product_sale",
    },
  ];

  assert.deepEqual(
    matchedPaymentsForOrder("ord_1", payments).map((payment) => payment.id),
    ["pay_sale"]
  );
});

test("characterizes duplicate receipt detection without automatic status changes", () => {
  const payments = [
    { id: "pay_a", receipt: "QH80DUP001", amount: 1000 },
    { id: "pay_b", receipt: "qh80dup001", amount: 1000 },
  ];

  assert.deepEqual(
    findDuplicatePayments(payments).map((payment) => payment.id),
    ["pay_b"]
  );
  assert.equal(payments[1].status, undefined);
});

test("characterizes summary and owner report figures from seed data", () => {
  const asOf = new Date("2026-08-06T12:00:00+03:00");
  const state = createSeedData(asOf);
  const summary = getSummary(state, asOf);

  assert.deepEqual(summary, {
    enquiries: 1,
    confirmedOrders: 2,
    paidOrders: 1,
    collected: 13850,
    unmatched: 9850,
    unpaidReservations: 8900,
    grossProfit: 1600,
    lowStockCount: 0,
    followUps: 4,
    matchRate: 40,
  });

  assert.match(dailyOwnerReport(state, asOf), /^Dukaspot daily report - /);
});

test("derives inventory and customer records", () => {
  const state = createSeedData(new Date("2026-08-06T12:00:00+03:00"));
  const inventory = getInventoryRows(state.inventory, state.orders, state.payments);
  const customers = getCustomerProfiles(state.orders, state.payments);

  assert.ok(inventory.some((item) => item.productName === "Denim midi dress"));
  assert.ok(customers.some((customer) => customer.name === "Brian Otieno"));
  const customer = customers.find((entry) => entry.name === "Brian Otieno");
  assert.equal(Object.hasOwn(customer, "preferredProducts"), false);
  assert.equal(Object.hasOwn(customer, "assignedAgents"), false);
});

for (const { name, fn } of tests) {
  fn();
  console.log(`PASS ${name}`);
}
