import crypto from "node:crypto";
import {
  createSeedData,
  orderTotal,
  parseMpesaCsv,
  uid,
} from "@dukaspot/core";
import { normalizeState, withAudit } from "./file-repository.js";

const DEFAULT_LOCATION_NAME = "Default";
const ACCOUNT_NAMES = {
  "1000_MPESA_CASH": "M-PESA cash",
  "1100_ACCOUNTS_RECEIVABLE": "Accounts receivable",
  "1200_INVENTORY": "Inventory",
  "3000_OWNER_DRAW": "Owner draw",
  "3100_OWNER_CONTRIBUTION": "Owner contribution",
  "4000_SALES_REVENUE": "Sales revenue",
  "4010_DELIVERY_REVENUE": "Delivery revenue",
  "4020_SALES_DISCOUNTS": "Sales discounts",
  "5000_COST_OF_GOODS_SOLD": "Cost of goods sold",
  "5100_SUPPLIER_PAYMENTS": "Supplier payments",
  "5200_BUSINESS_EXPENSE": "Business expense",
  "5300_CUSTOMER_REFUNDS": "Customer refunds",
  "9999_SUSPENSE": "Suspense",
};
const ACCOUNTS = {
  cash: "1000_MPESA_CASH",
  receivable: "1100_ACCOUNTS_RECEIVABLE",
  inventory: "1200_INVENTORY",
  ownerDraw: "3000_OWNER_DRAW",
  ownerContribution: "3100_OWNER_CONTRIBUTION",
  salesRevenue: "4000_SALES_REVENUE",
  deliveryRevenue: "4010_DELIVERY_REVENUE",
  salesDiscounts: "4020_SALES_DISCOUNTS",
  cogs: "5000_COST_OF_GOODS_SOLD",
  supplierPayments: "5100_SUPPLIER_PAYMENTS",
  businessExpense: "5200_BUSINESS_EXPENSE",
  customerRefunds: "5300_CUSTOMER_REFUNDS",
  suspense: "9999_SUSPENSE",
};

export class PostgresCommerceLedgerRepository {
  constructor({ pool, merchantId } = {}) {
    if (!pool) throw new Error("PostgresCommerceLedgerRepository requires pool");
    if (!merchantId) throw new Error("PostgresCommerceLedgerRepository requires merchantId");
    this.pool = pool;
    this.merchantId = merchantId;
  }

  forMerchant(merchantId) {
    return new PostgresCommerceLedgerRepository({ pool: this.pool, merchantId });
  }

  async runIdempotent({ key, requestHash, method = "", path = "", operation }) {
    const existing = await this.pool.query(
      `
        select request_hash, status_code, response_body
        from idempotency_records
        where merchant_id = $1 and idempotency_key = $2
      `,
      [this.merchantId, key]
    );

    if (existing.rowCount) {
      const record = existing.rows[0];
      if (record.request_hash !== requestHash) throw idempotencyConflictError();
      return {
        statusCode: record.status_code,
        body: record.response_body,
        replayed: true,
      };
    }

    const response = await operation();
    await this.pool.query(
      `
        insert into idempotency_records (
          merchant_id,
          idempotency_key,
          method,
          path,
          request_hash,
          status_code,
          response_body
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        on conflict (merchant_id, idempotency_key) do nothing
      `,
      [
        this.merchantId,
        key,
        method,
        path,
        requestHash,
        response.statusCode,
        JSON.stringify(response.body),
      ]
    );
    return response;
  }

  async getLedger() {
    const client = await this.pool.connect();
    try {
      await this._ensureSeeded(client);
      return this._readState(client);
    } finally {
      client.release();
    }
  }

  async getTrialBalance() {
    const client = await this.pool.connect();
    try {
      await this._ensureSeeded(client);
      return readTrialBalance(client, this.merchantId);
    } finally {
      client.release();
    }
  }

  async replaceLedger(nextState, action = "Replaced ledger state") {
    const state = normalizeState(nextState);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this._replaceState(client, state);
      const nextStateWithAudit = withAudit(await this._readState(client), action);
      await writeSnapshot(client, this.merchantId, nextStateWithAudit);
      await writeOutboxEvent(client, this.merchantId, "ledger.replaced", action, {
        orderCount: nextStateWithAudit.orders.length,
        paymentCount: nextStateWithAudit.payments.length,
        inventoryCount: nextStateWithAudit.inventory.length,
      });
      await client.query("commit");
      return { state: nextStateWithAudit, message: action };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async resetDemo() {
    return this.replaceLedger(createSeedData(), "Demo data reset");
  }

  async createOrder(order) {
    return this._mutate(`Captured order for ${order.customerName}`, async (client) => {
      const nextOrder = {
        ...order,
        id: order.id || uid("ord"),
      };
      await upsertOrder(client, this.merchantId, nextOrder);
      await postOrderJournals(client, this.merchantId, nextOrder);
    });
  }

  async importPayments(csv) {
    const parsed = parseMpesaCsv(csv);
    if (!parsed.length) {
      return {
        state: await this.getLedger(),
        imported: 0,
        message: "No CSV rows found",
      };
    }

    return this._mutate("Imported M-PESA transactions", async (client) => {
      const receipts = parsed.map((payment) => String(payment.receipt).toLowerCase());
      const existing = await client.query(
        `
          select lower(receipt) as receipt
          from payments
          where merchant_id = $1
            and provider = 'MPESA_TILL'
            and lower(receipt) = any($2::text[])
        `,
        [this.merchantId, receipts]
      );
      const existingReceipts = new Set(existing.rows.map((row) => row.receipt));
      const fresh = parsed.filter(
        (payment) => !existingReceipts.has(String(payment.receipt).toLowerCase())
      );

      if (!fresh.length) {
        return {
          skipWrite: true,
          imported: 0,
          message: "No new M-PESA transactions found",
        };
      }

      for (const payment of fresh) {
        await upsertPayment(client, this.merchantId, payment);
        await postClassifiedPaymentJournal(client, this.merchantId, payment);
      }

      return {
        imported: fresh.length,
        action: `Imported ${fresh.length} M-PESA transactions`,
      };
    });
  }

  async matchPayment(paymentId, orderId) {
    return this._mutate(`Matched payment ${shortId(paymentId)}`, async (client) => {
      const payment = await findPayment(client, this.merchantId, paymentId);
      const order = await findOrder(client, this.merchantId, orderId);
      await reverseJournalEntries(
        client,
        this.merchantId,
        paymentAllocationSourcePrefix(payment.external_id)
      );
      await reverseJournalEntries(
        client,
        this.merchantId,
        paymentClassificationSourcePrefix(payment.external_id)
      );
      await client.query(
        "delete from payment_allocations where merchant_id = $1 and payment_id = $2",
        [this.merchantId, payment.id]
      );
      await client.query(
        `
          insert into payment_allocations (
            merchant_id,
            payment_id,
            order_id,
            amount_minor,
            rule,
            confidence,
            explanation
          )
          values ($1, $2, $3, $4, 'manual', 100, 'Owner confirmed payment match')
          on conflict (merchant_id, payment_id, order_id)
          do update set amount_minor = excluded.amount_minor
        `,
        [this.merchantId, payment.id, order.id, payment.amount_minor]
      );
      await client.query(
        `
          update payments
          set status = 'ALLOCATED',
              classification = case
                when classification = 'unknown' then 'product_sale'
                else classification
              end,
              updated_at = now()
          where merchant_id = $1 and id = $2
        `,
        [this.merchantId, payment.id]
      );
      await postPaymentAllocationJournal(client, this.merchantId, payment, order);
    });
  }

  async classifyPayment(paymentId, classification) {
    return this._mutate(`Classified payment as ${titleCase(classification)}`, async (client) => {
      const payment = await findPayment(client, this.merchantId, paymentId);
      await reverseJournalEntries(
        client,
        this.merchantId,
        paymentAllocationSourcePrefix(payment.external_id)
      );
      await reverseJournalEntries(
        client,
        this.merchantId,
        paymentClassificationSourcePrefix(payment.external_id)
      );
      await client.query(
        "delete from payment_allocations where merchant_id = $1 and payment_id = $2",
        [this.merchantId, payment.id]
      );
      await client.query(
        `
          update payments
          set status = 'CLASSIFIED',
              classification = $3,
              updated_at = now()
          where merchant_id = $1 and id = $2
        `,
        [this.merchantId, payment.id, classification]
      );
      await postClassifiedPaymentJournal(client, this.merchantId, {
        externalId: payment.external_id,
        id: payment.external_id,
        amountMinor: payment.amount_minor,
        classification,
      });
    });
  }

  async unmatchPayment(paymentId) {
    return this._mutate(`Unmatched payment ${shortId(paymentId)}`, async (client) => {
      const payment = await findPayment(client, this.merchantId, paymentId);
      await reverseJournalEntries(
        client,
        this.merchantId,
        paymentAllocationSourcePrefix(payment.external_id)
      );
      await reverseJournalEntries(
        client,
        this.merchantId,
        paymentClassificationSourcePrefix(payment.external_id)
      );
      await client.query(
        "delete from payment_allocations where merchant_id = $1 and payment_id = $2",
        [this.merchantId, payment.id]
      );
      await client.query(
        `
          update payments
          set status = 'UNMATCHED',
              classification = 'unknown',
              updated_at = now()
          where merchant_id = $1 and id = $2
        `,
        [this.merchantId, payment.id]
      );
    });
  }

  async updateOrder(orderId, patch) {
    return this._mutate("Updated order", async (client) => {
      const currentOrder = await readOrderForAccounting(client, this.merchantId, orderId);
      const updates = [];
      const values = [this.merchantId, orderId];
      addOrderPatch(updates, values, "stage", patch.stage);
      addOrderPatch(updates, values, "notes", patch.notes);
      addOrderPatch(updates, values, "location", patch.location);
      addOrderPatch(updates, values, "agent", patch.agent);
      if (patch.stage) {
        values.push(stageToOrderStatus(patch.stage));
        updates.push(`status = $${values.length}`);
      }
      if (!updates.length) return;
      await client.query(
        `
          update orders
          set ${updates.join(", ")},
              updated_at = now()
          where merchant_id = $1 and order_number = $2
        `,
        values
      );
      const updatedOrder = await readOrderForAccounting(client, this.merchantId, orderId);
      if (isPostedOrderStage(updatedOrder.stage)) {
        await postOrderJournals(client, this.merchantId, updatedOrder);
      } else if (isPostedOrderStage(currentOrder.stage)) {
        await reverseJournalEntries(
          client,
          this.merchantId,
          orderSourcePrefix(updatedOrder.id)
        );
      }
    });
  }

  async markFollowUp(orderId) {
    return this._mutate("Marked follow-up complete", async (client) => {
      await findOrder(client, this.merchantId, orderId);
      await client.query(
        `
          update orders
          set last_follow_up_at = now(),
              updated_at = now()
          where merchant_id = $1 and order_number = $2
        `,
        [this.merchantId, orderId]
      );
    });
  }

  async addInventoryItem(item) {
    return this._mutate(`Added inventory item ${item.sku}`, async (client) => {
      await ensureVariantForInventory(client, this.merchantId, item);
    });
  }

  async restockItem(itemId, quantity) {
    return this._mutate("Restocked inventory item", async (client) => {
      const variant = await findVariant(client, this.merchantId, itemId);
      const locationId = await ensureDefaultLocation(client, this.merchantId);
      await client.query(
        `
          insert into inventory_movements (
            merchant_id,
            variant_id,
            location_id,
            movement_type,
            quantity,
            source_event_id
          )
          values ($1, $2, $3, 'PURCHASE', $4, $5)
        `,
        [
          this.merchantId,
          variant.id,
          locationId,
          Number(quantity) || 0,
          `restock-${itemId}-${crypto.randomUUID()}`,
        ]
      );
    });
  }

  async _mutate(defaultAction, operation) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this._ensureSeeded(client);
      const result = (await operation(client)) || {};

      if (result.skipWrite) {
        await client.query("commit");
        return {
          state: await this.getLedger(),
          imported: result.imported,
          message: result.message || defaultAction,
        };
      }

      const action = result.action || defaultAction;
      const state = withAudit(await this._readState(client), action);
      await writeSnapshot(client, this.merchantId, state);
      await writeOutboxEvent(client, this.merchantId, eventTypeForAction(action), action, {
        orders: state.orders.length,
        payments: state.payments.length,
        inventory: state.inventory.length,
      });
      await client.query("commit");
      return {
        state,
        imported: result.imported,
        message: action,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async _ensureSeeded(client) {
    const merchant = await client.query("select 1 from merchants where id = $1", [
      this.merchantId,
    ]);
    if (!merchant.rowCount) throw tenantDeniedError();

    const existing = await client.query(
      `
        select
          (select count(*)::int from orders where merchant_id = $1) as orders,
          (select count(*)::int from payments where merchant_id = $1) as payments,
          (select count(*)::int from product_variants where merchant_id = $1) as variants
      `,
      [this.merchantId]
    );
    const row = existing.rows[0];
    if (row.orders || row.payments || row.variants) return;

    const seed = createSeedData();
    await this._replaceState(client, seed);
    await writeSnapshot(client, this.merchantId, withAudit(seed, "Initialized demo ledger"));
  }

  async _replaceState(client, state) {
    await clearCommerceState(client, this.merchantId);

    for (const item of state.inventory) {
      await ensureVariantForInventory(client, this.merchantId, item);
    }

    for (const order of state.orders) {
      await upsertOrder(client, this.merchantId, order);
    }

    for (const payment of state.payments) {
      await upsertPayment(client, this.merchantId, payment);
    }

    for (const payment of state.payments.filter((entry) => entry.orderId)) {
      const dbPayment = await findPayment(client, this.merchantId, payment.id);
      const dbOrder = await findOrder(client, this.merchantId, payment.orderId);
      await client.query(
        `
          insert into payment_allocations (
            merchant_id,
            payment_id,
            order_id,
            amount_minor,
            rule,
            confidence,
            explanation
          )
          values ($1, $2, $3, $4, 'legacy_seed', 100, 'Imported from pilot ledger state')
          on conflict (merchant_id, payment_id, order_id) do nothing
        `,
        [this.merchantId, dbPayment.id, dbOrder.id, toMinor(payment.amount)]
      );
    }

    await postAccountingForState(client, this.merchantId, state);
  }

  async _readState(client) {
    const merchantResult = await client.query(
      "select trading_name, currency from merchants where id = $1",
      [this.merchantId]
    );
    if (!merchantResult.rowCount) throw tenantDeniedError();
    const merchant = merchantResult.rows[0];

    const inventory = await readInventory(client, this.merchantId);
    const orders = await readOrders(client, this.merchantId);
    const payments = await readPayments(client, this.merchantId);
    const auditLog = await readSnapshotAudit(client, this.merchantId);

    return normalizeState({
      merchant: {
        name: merchant.trading_name,
        till: "",
        segment: "Social seller",
        currency: merchant.currency || "KES",
      },
      agents: [...new Set(orders.map((order) => order.agent).filter(Boolean))],
      inventory,
      orders,
      payments,
      auditLog,
    });
  }
}

async function clearCommerceState(client, merchantId) {
  await client.query("delete from journal_lines where merchant_id = $1", [merchantId]);
  await client.query("delete from journal_entries where merchant_id = $1", [merchantId]);
  await client.query("delete from payment_allocations where merchant_id = $1", [merchantId]);
  await client.query("delete from payments where merchant_id = $1", [merchantId]);
  await client.query("delete from order_items where merchant_id = $1", [merchantId]);
  await client.query("delete from orders where merchant_id = $1", [merchantId]);
  await client.query("delete from inventory_movements where merchant_id = $1", [merchantId]);
  await client.query("delete from product_variants where merchant_id = $1", [merchantId]);
  await client.query("delete from products where merchant_id = $1", [merchantId]);
  await client.query("delete from customers where merchant_id = $1", [merchantId]);
  await client.query("delete from inventory_locations where merchant_id = $1", [merchantId]);
}

async function postAccountingForState(client, merchantId, state) {
  for (const order of state.orders) {
    await postOrderJournals(client, merchantId, order);
  }

  for (const payment of state.payments) {
    if (payment.orderId) {
      await postPaymentAllocationJournal(client, merchantId, payment, {
        order_number: payment.orderId,
      });
      continue;
    }
    await postClassifiedPaymentJournal(client, merchantId, payment);
  }
}

async function readTrialBalance(client, merchantId) {
  const merchant = await client.query("select currency from merchants where id = $1", [
    merchantId,
  ]);
  if (!merchant.rowCount) throw tenantDeniedError();

  const result = await client.query(
    `
      select
        l.account_code,
        coalesce(sum(l.debit_minor), 0)::text as debit_minor,
        coalesce(sum(l.credit_minor), 0)::text as credit_minor
      from journal_lines l
      join journal_entries e
        on e.id = l.journal_entry_id
       and e.merchant_id = l.merchant_id
      where l.merchant_id = $1
        and e.status = 'POSTED'
      group by l.account_code
      order by l.account_code
    `,
    [merchantId]
  );

  const accounts = result.rows.map((row) => {
    const debitMinor = Number(row.debit_minor) || 0;
    const creditMinor = Number(row.credit_minor) || 0;
    return {
      accountCode: row.account_code,
      accountName: ACCOUNT_NAMES[row.account_code] || titleCase(row.account_code),
      debit: fromMinor(debitMinor),
      credit: fromMinor(creditMinor),
      balance: fromMinor(debitMinor - creditMinor),
    };
  });
  const totalDebitMinor = accounts.reduce((total, account) => total + toMinor(account.debit), 0);
  const totalCreditMinor = accounts.reduce((total, account) => total + toMinor(account.credit), 0);

  return {
    merchantId,
    currency: merchant.rows[0].currency || "KES",
    generatedAt: new Date().toISOString(),
    accounts,
    totalDebits: fromMinor(totalDebitMinor),
    totalCredits: fromMinor(totalCreditMinor),
    balanced: totalDebitMinor === totalCreditMinor,
  };
}

async function postOrderJournals(client, merchantId, order) {
  if (!isPostedOrderStage(order.stage)) {
    await reverseJournalEntries(client, merchantId, orderSourcePrefix(order.id));
    return;
  }

  const quantity = Number(order.quantity) || 1;
  const subtotalMinor = toMinor(quantity * (Number(order.unitPrice) || 0));
  const deliveryMinor = toMinor(order.deliveryFee);
  const discountMinor = Math.min(
    toMinor(order.discount),
    Math.max(0, subtotalMinor + deliveryMinor)
  );
  const totalMinor = Math.max(0, subtotalMinor + deliveryMinor - discountMinor);

  await postJournalEntry(client, merchantId, `${orderSourcePrefix(order.id)}sale`, [
    debit(ACCOUNTS.receivable, totalMinor),
    debit(ACCOUNTS.salesDiscounts, discountMinor),
    credit(ACCOUNTS.salesRevenue, subtotalMinor),
    credit(ACCOUNTS.deliveryRevenue, deliveryMinor),
  ]);

  const costMinor = toMinor(quantity * (Number(order.unitCost) || 0));
  await postJournalEntry(client, merchantId, `${orderSourcePrefix(order.id)}cogs`, [
    debit(ACCOUNTS.cogs, costMinor),
    credit(ACCOUNTS.inventory, costMinor),
  ]);
}

async function postPaymentAllocationJournal(client, merchantId, payment, order) {
  const amountMinor = signedPaymentMinor(payment);
  const sourceEventId = `${paymentAllocationSourcePrefix(paymentExternalId(payment))}${sourceIdPart(
    order.order_number || order.id || order.orderId
  )}`;
  const amount = Math.abs(amountMinor);
  const lines =
    amountMinor >= 0
      ? [debit(ACCOUNTS.cash, amount), credit(ACCOUNTS.receivable, amount)]
      : [debit(ACCOUNTS.receivable, amount), credit(ACCOUNTS.cash, amount)];

  await postJournalEntry(client, merchantId, sourceEventId, lines);
}

async function postClassifiedPaymentJournal(client, merchantId, payment) {
  const classification = String(payment.classification || "unknown");
  if (!classification || classification === "unknown" || classification === "product_sale") return;

  const amountMinor = signedPaymentMinor(payment);
  const amount = Math.abs(amountMinor);
  if (!amount) return;

  const sourceEventId = `${paymentClassificationSourcePrefix(
    paymentExternalId(payment)
  )}${sourceIdPart(classification)}`;
  const counterAccount = accountForPaymentClassification(classification, amountMinor);
  if (!counterAccount) return;

  const lines =
    amountMinor >= 0
      ? [debit(ACCOUNTS.cash, amount), credit(counterAccount, amount)]
      : [debit(counterAccount, amount), credit(ACCOUNTS.cash, amount)];

  await postJournalEntry(client, merchantId, sourceEventId, lines);
}

async function postJournalEntry(client, merchantId, sourceEventId, lines) {
  const normalized = normalizeJournalLines(lines);
  if (!normalized.length) return null;

  const debitTotal = normalized.reduce((total, line) => total + line.debitMinor, 0);
  const creditTotal = normalized.reduce((total, line) => total + line.creditMinor, 0);
  if (debitTotal !== creditTotal) {
    throw accountingError(`Journal entry ${sourceEventId} is not balanced`);
  }

  const existing = await client.query(
    `
      select id, status
      from journal_entries
      where merchant_id = $1 and source_event_id = $2
    `,
    [merchantId, sourceEventId]
  );
  if (existing.rowCount) {
    if (existing.rows[0].status === "REVERSED") {
      await client.query(
        "delete from journal_entries where merchant_id = $1 and source_event_id = $2",
        [merchantId, reversalSourceEventId(sourceEventId)]
      );
      await client.query(
        "update journal_entries set status = 'POSTED' where merchant_id = $1 and id = $2",
        [merchantId, existing.rows[0].id]
      );
    }
    return existing.rows[0].id;
  }

  const entry = await client.query(
    `
      insert into journal_entries (merchant_id, source_event_id, currency, status)
      values ($1, $2, 'KES', 'POSTED')
      returning id
    `,
    [merchantId, sourceEventId]
  );
  const journalEntryId = entry.rows[0].id;

  for (const line of normalized) {
    await client.query(
      `
        insert into journal_lines (
          merchant_id,
          journal_entry_id,
          account_code,
          debit_minor,
          credit_minor
        )
        values ($1, $2, $3, $4, $5)
      `,
      [merchantId, journalEntryId, line.accountCode, line.debitMinor, line.creditMinor]
    );
  }

  return journalEntryId;
}

async function reverseJournalEntries(client, merchantId, sourcePrefix) {
  const entries = await client.query(
    `
      select id, source_event_id
      from journal_entries
      where merchant_id = $1
        and source_event_id like $2
        and status = 'POSTED'
      order by created_at asc
    `,
    [merchantId, `${sourcePrefix}%`]
  );

  for (const entry of entries.rows) {
    const lines = await client.query(
      `
        select account_code, debit_minor, credit_minor
        from journal_lines
        where merchant_id = $1 and journal_entry_id = $2
      `,
      [merchantId, entry.id]
    );
    await postJournalEntry(
      client,
      merchantId,
      reversalSourceEventId(entry.source_event_id),
      lines.rows.map((line) => ({
        accountCode: line.account_code,
        debitMinor: Number(line.credit_minor) || 0,
        creditMinor: Number(line.debit_minor) || 0,
      }))
    );
    await client.query(
      "update journal_entries set status = 'REVERSED' where merchant_id = $1 and id = $2",
      [merchantId, entry.id]
    );
  }
}

async function upsertOrder(client, merchantId, order) {
  const customerId = await upsertCustomer(client, merchantId, {
    name: order.customerName,
    phone: order.phone,
  });
  const variantId = await ensureVariantForOrder(client, merchantId, order);
  const orderNumber = String(order.id || uid("ord"));
  const result = await client.query(
    `
      insert into orders (
        merchant_id,
        customer_id,
        order_number,
        status,
        stage,
        payment_status,
        currency,
        total_minor,
        delivery_fee_minor,
        discount_minor,
        source,
        location,
        agent,
        notes,
        last_follow_up_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, 'KES', $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
      on conflict (merchant_id, order_number)
      do update set
        customer_id = excluded.customer_id,
        status = excluded.status,
        stage = excluded.stage,
        payment_status = excluded.payment_status,
        total_minor = excluded.total_minor,
        delivery_fee_minor = excluded.delivery_fee_minor,
        discount_minor = excluded.discount_minor,
        source = excluded.source,
        location = excluded.location,
        agent = excluded.agent,
        notes = excluded.notes,
        last_follow_up_at = excluded.last_follow_up_at,
        updated_at = now()
      returning id
    `,
    [
      merchantId,
      customerId,
      orderNumber,
      stageToOrderStatus(order.stage),
      order.stage || "confirmed",
      order.paymentStatus || "unpaid",
      toMinor(orderTotal(order)),
      toMinor(order.deliveryFee),
      toMinor(order.discount),
      order.source || "WhatsApp",
      order.location || "",
      order.agent || "Unassigned",
      order.notes || "",
      order.lastFollowUpAt ? new Date(order.lastFollowUpAt) : null,
      order.createdAt ? new Date(order.createdAt) : new Date(),
    ]
  );
  const orderId = result.rows[0].id;
  await client.query("delete from order_items where merchant_id = $1 and order_id = $2", [
    merchantId,
    orderId,
  ]);
  await client.query(
    `
      insert into order_items (
        merchant_id,
        order_id,
        variant_id,
        description,
        quantity,
        unit_selling_price_minor,
        unit_cost_minor,
        discount_minor,
        tax_minor
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, 0)
    `,
    [
      merchantId,
      orderId,
      variantId,
      `${order.productName || "Item"} ${order.variant || ""}`.trim(),
      Number(order.quantity) || 1,
      toMinor(order.unitPrice),
      toMinor(order.unitCost),
      toMinor(order.discount),
    ]
  );
  return orderId;
}

async function upsertPayment(client, merchantId, payment) {
  await client.query(
    `
      insert into payments (
        merchant_id,
        external_id,
        provider,
        receipt,
        payer_phone,
        payer_name,
        amount_minor,
        currency,
        status,
        classification,
        details,
        received_at,
        imported_at,
        updated_at
      )
      values ($1, $2, 'MPESA_TILL', $3, $4, $5, $6, 'KES', $7, $8, $9, $10, $11, now())
      on conflict (merchant_id, external_id)
      do update set
        receipt = excluded.receipt,
        payer_phone = excluded.payer_phone,
        payer_name = excluded.payer_name,
        amount_minor = excluded.amount_minor,
        status = excluded.status,
        classification = excluded.classification,
        details = excluded.details,
        received_at = excluded.received_at,
        imported_at = excluded.imported_at,
        updated_at = now()
    `,
    [
      merchantId,
      payment.id || `pay_${payment.receipt || uid("mpesa")}`,
      payment.receipt || null,
      payment.phone || "",
      payment.payerName || "",
      toMinor(payment.amount),
      paymentStatusToDb(payment.status),
      payment.classification || "unknown",
      payment.details || "",
      payment.receivedAt ? new Date(payment.receivedAt) : new Date(),
      payment.importedAt ? new Date(payment.importedAt) : new Date(),
    ]
  );
}

async function upsertCustomer(client, merchantId, customer) {
  const phone = customer.phone || null;
  if (!phone) {
    const result = await client.query(
      `
        insert into customers (merchant_id, display_name, primary_phone)
        values ($1, $2, null)
        returning id
      `,
      [merchantId, customer.name || "Unknown customer"]
    );
    return result.rows[0].id;
  }

  const result = await client.query(
    `
      insert into customers (merchant_id, display_name, primary_phone)
      values ($1, $2, $3)
      on conflict (merchant_id, primary_phone)
      do update set display_name = excluded.display_name, updated_at = now()
      returning id
    `,
    [merchantId, customer.name || phone, phone]
  );
  return result.rows[0].id;
}

async function ensureVariantForInventory(client, merchantId, item) {
  const productId = await upsertProduct(client, merchantId, item.productName || item.sku);
  const sku = item.sku || stableSku(item.productName, item.variant);
  const result = await client.query(
    `
      insert into product_variants (
        merchant_id,
        product_id,
        external_id,
        sku,
        name,
        selling_price_minor,
        cost_price_minor,
        reorder_point,
        opening_stock,
        currency,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'KES', now())
      on conflict (merchant_id, sku)
      do update set
        product_id = excluded.product_id,
        external_id = excluded.external_id,
        name = excluded.name,
        selling_price_minor = excluded.selling_price_minor,
        cost_price_minor = excluded.cost_price_minor,
        reorder_point = excluded.reorder_point,
        opening_stock = excluded.opening_stock,
        updated_at = now()
      returning id
    `,
    [
      merchantId,
      productId,
      item.id || null,
      sku,
      item.variant || "Default",
      toMinor(item.sellingPrice),
      toMinor(item.unitCost),
      Number(item.reorderPoint) || 0,
      Number(item.onHand) || 0,
    ]
  );
  await ensureDefaultLocation(client, merchantId);
  return result.rows[0].id;
}

async function ensureVariantForOrder(client, merchantId, order) {
  const existing = await client.query(
    `
      select v.id
      from product_variants v
      join products p on p.id = v.product_id
      where v.merchant_id = $1
        and lower(p.name) = lower($2)
        and lower(v.name) = lower($3)
      limit 1
    `,
    [merchantId, order.productName || "Item", order.variant || "Default"]
  );
  if (existing.rowCount) return existing.rows[0].id;

  const productId = await upsertProduct(client, merchantId, order.productName || "Item");
  const result = await client.query(
    `
      insert into product_variants (
        merchant_id,
        product_id,
        sku,
        name,
        selling_price_minor,
        cost_price_minor,
        currency,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, 'KES', now())
      on conflict (merchant_id, sku)
      do update set
        selling_price_minor = excluded.selling_price_minor,
        cost_price_minor = excluded.cost_price_minor,
        updated_at = now()
      returning id
    `,
    [
      merchantId,
      productId,
      stableSku(order.productName, order.variant),
      order.variant || "Default",
      toMinor(order.unitPrice),
      toMinor(order.unitCost),
    ]
  );
  return result.rows[0].id;
}

async function upsertProduct(client, merchantId, name) {
  const result = await client.query(
    `
      insert into products (merchant_id, name, updated_at)
      values ($1, $2, now())
      on conflict (merchant_id, name)
      do update set active = true, updated_at = now()
      returning id
    `,
    [merchantId, name || "Item"]
  );
  return result.rows[0].id;
}

async function ensureDefaultLocation(client, merchantId) {
  const result = await client.query(
    `
      insert into inventory_locations (merchant_id, name, updated_at)
      values ($1, $2, now())
      on conflict (merchant_id, name)
      do update set updated_at = now()
      returning id
    `,
    [merchantId, DEFAULT_LOCATION_NAME]
  );
  return result.rows[0].id;
}

async function findOrder(client, merchantId, orderNumber) {
  const result = await client.query(
    "select id, order_number, stage from orders where merchant_id = $1 and order_number = $2",
    [merchantId, orderNumber]
  );
  if (!result.rowCount) throw notFoundError("Order not found");
  return result.rows[0];
}

async function findPayment(client, merchantId, paymentId) {
  const result = await client.query(
    `
      select id, external_id, amount_minor, classification, status
      from payments
      where merchant_id = $1 and external_id = $2
    `,
    [merchantId, paymentId]
  );
  if (!result.rowCount) throw notFoundError("Payment not found");
  return result.rows[0];
}

async function readOrderForAccounting(client, merchantId, orderNumber) {
  const result = await client.query(
    `
      select
        o.order_number,
        o.stage,
        oi.quantity,
        oi.unit_selling_price_minor,
        oi.unit_cost_minor,
        o.discount_minor,
        o.delivery_fee_minor
      from orders o
      left join lateral (
        select *
        from order_items
        where merchant_id = o.merchant_id and order_id = o.id
        order by id
        limit 1
      ) oi on true
      where o.merchant_id = $1 and o.order_number = $2
    `,
    [merchantId, orderNumber]
  );
  if (!result.rowCount) throw notFoundError("Order not found");
  const row = result.rows[0];
  return {
    id: row.order_number,
    stage: row.stage || "confirmed",
    quantity: Number(row.quantity) || 1,
    unitPrice: fromMinor(row.unit_selling_price_minor),
    unitCost: fromMinor(row.unit_cost_minor),
    discount: fromMinor(row.discount_minor),
    deliveryFee: fromMinor(row.delivery_fee_minor),
  };
}

async function findVariant(client, merchantId, itemId) {
  const result = await client.query(
    `
      select id
      from product_variants
      where merchant_id = $1
        and (external_id = $2 or sku = $2)
      limit 1
    `,
    [merchantId, itemId]
  );
  if (!result.rowCount) throw notFoundError("Inventory item not found");
  return result.rows[0];
}

async function readInventory(client, merchantId) {
  const result = await client.query(
    `
      select
        coalesce(v.external_id, v.sku) as id,
        v.sku,
        p.name as product_name,
        v.name as variant,
        v.opening_stock + coalesce(sum(im.quantity), 0) as on_hand,
        v.reorder_point,
        v.cost_price_minor,
        v.selling_price_minor
      from product_variants v
      join products p on p.id = v.product_id
      left join inventory_movements im on im.variant_id = v.id and im.merchant_id = v.merchant_id
      where v.merchant_id = $1
      group by v.id, p.name
      order by v.created_at asc
    `,
    [merchantId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    productName: row.product_name,
    variant: row.variant === "Default" ? "" : row.variant,
    onHand: Number(row.on_hand) || 0,
    reorderPoint: Number(row.reorder_point) || 0,
    unitCost: fromMinor(row.cost_price_minor),
    sellingPrice: fromMinor(row.selling_price_minor),
  }));
}

async function readOrders(client, merchantId) {
  const result = await client.query(
    `
      select
        o.order_number,
        o.created_at,
        c.display_name as customer_name,
        c.primary_phone,
        p.name as product_name,
        v.name as variant,
        oi.description,
        oi.quantity,
        oi.unit_selling_price_minor,
        oi.unit_cost_minor,
        o.discount_minor,
        o.delivery_fee_minor,
        o.location,
        o.source,
        o.agent,
        o.stage,
        o.payment_status,
        o.notes,
        o.last_follow_up_at
      from orders o
      left join customers c on c.id = o.customer_id
      left join lateral (
        select *
        from order_items
        where merchant_id = o.merchant_id and order_id = o.id
        order by id
        limit 1
      ) oi on true
      left join product_variants v on v.id = oi.variant_id
      left join products p on p.id = v.product_id
      where o.merchant_id = $1
      order by o.created_at desc
    `,
    [merchantId]
  );

  return result.rows.map((row) => ({
    id: row.order_number,
    createdAt: toIso(row.created_at),
    customerName: row.customer_name || "Unknown customer",
    phone: row.primary_phone || "",
    productName: row.product_name || row.description || "Item",
    variant: row.variant === "Default" ? "" : row.variant || "",
    quantity: Number(row.quantity) || 1,
    unitPrice: fromMinor(row.unit_selling_price_minor),
    unitCost: fromMinor(row.unit_cost_minor),
    discount: fromMinor(row.discount_minor),
    deliveryFee: fromMinor(row.delivery_fee_minor),
    location: row.location || "",
    source: row.source || "WhatsApp",
    agent: row.agent || "Unassigned",
    stage: row.stage || orderStatusToStage(row.status),
    paymentStatus: row.payment_status || "unpaid",
    notes: row.notes || "",
    lastFollowUpAt: row.last_follow_up_at ? toIso(row.last_follow_up_at) : "",
  }));
}

async function readPayments(client, merchantId) {
  const result = await client.query(
    `
      select
        p.external_id,
        p.receipt,
        p.received_at,
        p.payer_name,
        p.payer_phone,
        p.amount_minor,
        p.details,
        p.classification,
        p.status,
        p.imported_at,
        allocation.order_number
      from payments p
      left join lateral (
        select o.order_number
        from payment_allocations pa
        join orders o on o.id = pa.order_id
        where pa.merchant_id = p.merchant_id and pa.payment_id = p.id
        order by pa.created_at desc
        limit 1
      ) allocation on true
      where p.merchant_id = $1
      order by p.received_at desc
    `,
    [merchantId]
  );

  return result.rows.map((row) => ({
    id: row.external_id,
    receipt: row.receipt || "",
    receivedAt: toIso(row.received_at),
    payerName: row.payer_name || "",
    phone: row.payer_phone || "",
    amount: fromMinor(row.amount_minor),
    details: row.details || "",
    classification: row.classification || "unknown",
    status: paymentStatusFromDb(row.status),
    orderId: row.order_number || "",
    importedAt: row.imported_at ? toIso(row.imported_at) : toIso(row.received_at),
  }));
}

async function readSnapshotAudit(client, merchantId) {
  const result = await client.query("select state from ledger_states where merchant_id = $1", [
    merchantId,
  ]);
  if (!result.rowCount) return [];
  return Array.isArray(result.rows[0].state?.auditLog) ? result.rows[0].state.auditLog : [];
}

async function writeSnapshot(client, merchantId, state) {
  await client.query(
    `
      insert into ledger_states (merchant_id, state, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (merchant_id)
      do update set state = excluded.state, updated_at = now()
    `,
    [merchantId, JSON.stringify(normalizeState(state))]
  );
}

async function writeOutboxEvent(client, merchantId, eventType, action, payload) {
  await client.query(
    `
      insert into outbox_events (merchant_id, event_type, idempotency_key, payload)
      values ($1, $2, $3, $4::jsonb)
      on conflict (merchant_id, idempotency_key) do nothing
    `,
    [
      merchantId,
      eventType,
      `ledger-${crypto.randomUUID()}`,
      JSON.stringify({
        action,
        occurredAt: new Date().toISOString(),
        ...payload,
      }),
    ]
  );
}

function addOrderPatch(updates, values, column, value) {
  if (value === undefined) return;
  values.push(value);
  updates.push(`${column} = $${values.length}`);
}

function stageToOrderStatus(stage = "confirmed") {
  const normalized = String(stage).toLowerCase();
  if (normalized === "enquiry") return "DRAFT";
  if (normalized === "reserved") return "RESERVED";
  if (normalized === "confirmed") return "CONFIRMED";
  if (normalized === "dispatched") return "DISPATCHED";
  if (normalized === "cancelled") return "CANCELLED";
  if (normalized === "returned") return "REFUNDED";
  return "DRAFT";
}

function orderStatusToStage(status = "DRAFT") {
  if (status === "RESERVED") return "reserved";
  if (status === "CONFIRMED") return "confirmed";
  if (status === "DISPATCHED" || status === "DELIVERED") return "dispatched";
  if (status === "CANCELLED") return "cancelled";
  if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED") return "returned";
  return "enquiry";
}

function paymentStatusToDb(status = "unmatched") {
  const normalized = String(status).toLowerCase();
  if (normalized === "matched") return "ALLOCATED";
  if (normalized === "classified") return "CLASSIFIED";
  if (normalized === "duplicate") return "DUPLICATE";
  if (normalized === "refunded") return "REFUNDED";
  if (normalized === "failed") return "FAILED";
  return "UNMATCHED";
}

function paymentStatusFromDb(status = "UNMATCHED") {
  if (status === "ALLOCATED" || status === "PARTIALLY_ALLOCATED") return "matched";
  if (status === "CLASSIFIED") return "classified";
  if (status === "DUPLICATE") return "duplicate";
  if (status === "REFUNDED") return "refunded";
  if (status === "FAILED") return "failed";
  return "unmatched";
}

function stableSku(productName = "item", variant = "default") {
  const base = `${slugPart(productName)}-${slugPart(variant || "default")}`
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const digest = crypto
    .createHash("sha1")
    .update(`${productName}:${variant}`)
    .digest("hex")
    .slice(0, 8);
  return `${base || "item"}-${digest}`.toUpperCase();
}

function slugPart(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function eventTypeForAction(action) {
  return `ledger.${slugPart(action).replace(/-/g, "_") || "mutation"}`;
}

function debit(accountCode, amountMinor) {
  return {
    accountCode,
    debitMinor: Math.max(0, Math.round(Number(amountMinor) || 0)),
    creditMinor: 0,
  };
}

function credit(accountCode, amountMinor) {
  return {
    accountCode,
    debitMinor: 0,
    creditMinor: Math.max(0, Math.round(Number(amountMinor) || 0)),
  };
}

function normalizeJournalLines(lines) {
  return lines
    .map((line) => ({
      accountCode: String(line.accountCode || "").trim(),
      debitMinor: Math.max(0, Math.round(Number(line.debitMinor) || 0)),
      creditMinor: Math.max(0, Math.round(Number(line.creditMinor) || 0)),
    }))
    .filter((line) => {
      if (!line.accountCode) return false;
      if (line.debitMinor > 0 && line.creditMinor > 0) throw accountingError("Journal line cannot be two-sided");
      return line.debitMinor > 0 || line.creditMinor > 0;
    });
}

function isPostedOrderStage(stage = "confirmed") {
  return !["enquiry", "cancelled", "returned"].includes(String(stage).toLowerCase());
}

function orderSourcePrefix(orderId) {
  return `order:${sourceIdPart(orderId)}:`;
}

function paymentAllocationSourcePrefix(paymentId) {
  return `payment-allocation:${sourceIdPart(paymentId)}:`;
}

function paymentClassificationSourcePrefix(paymentId) {
  return `payment-classification:${sourceIdPart(paymentId)}:`;
}

function reversalSourceEventId(sourceEventId) {
  return `reversal:${sourceEventId}`;
}

function sourceIdPart(value = "") {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function paymentExternalId(payment) {
  return payment.external_id || payment.externalId || payment.id;
}

function signedPaymentMinor(payment) {
  if (payment.amount_minor !== undefined) return Number(payment.amount_minor) || 0;
  if (payment.amountMinor !== undefined) return Number(payment.amountMinor) || 0;
  return toMinor(payment.amount);
}

function accountForPaymentClassification(classification, amountMinor) {
  if (classification === "owner_deposit") return ACCOUNTS.ownerContribution;
  if (classification === "personal_transfer") {
    return amountMinor < 0 ? ACCOUNTS.ownerDraw : ACCOUNTS.ownerContribution;
  }
  if (classification === "supplier_payment") return ACCOUNTS.supplierPayments;
  if (classification === "business_expense") return ACCOUNTS.businessExpense;
  if (classification === "refund") return ACCOUNTS.customerRefunds;
  if (classification === "delivery_payment") return ACCOUNTS.deliveryRevenue;
  return ACCOUNTS.suspense;
}

function toMinor(value) {
  return Math.round((Number(value) || 0) * 100);
}

function fromMinor(value) {
  return (Number(value) || 0) / 100;
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function titleCase(value = "") {
  return String(value)
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.slice(1));
}

function shortId(value = "") {
  return String(value).slice(-8);
}

function notFoundError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = "NOT_FOUND";
  return error;
}

function tenantDeniedError() {
  const error = new Error("Tenant access denied");
  error.statusCode = 403;
  error.code = "TENANT_ACCESS_DENIED";
  return error;
}

function idempotencyConflictError() {
  const error = new Error("Idempotency key was already used for a different request");
  error.statusCode = 409;
  error.code = "CONFLICT";
  return error;
}

function accountingError(message) {
  const error = new Error(message);
  error.statusCode = 500;
  error.code = "ACCOUNTING_POSTING_ERROR";
  return error;
}
