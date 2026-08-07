import fs from "node:fs/promises";
import path from "node:path";
import { createSeedData, parseMpesaCsv, uid } from "@dukaspot/core";

export class FileLedgerRepository {
  constructor({ dataFile, merchantId = "pilot-merchant" } = {}) {
    if (!dataFile) throw new Error("FileLedgerRepository requires dataFile");
    this.dataFile = dataFile;
    this.merchantId = merchantId;
    this.writeQueue = Promise.resolve();
    this.idempotencyRecords = new Map();
  }

  forMerchant(_merchantId) {
    return this;
  }

  async runIdempotent({ key, requestHash, method = "", path = "", operation }) {
    const record = this.idempotencyRecords.get(key);
    if (record) {
      if (record.requestHash !== requestHash) throw idempotencyConflictError();
      return { ...clone(record.response), replayed: true };
    }

    const response = await operation();
    this.idempotencyRecords.set(key, {
      requestHash,
      method,
      path,
      response: clone(response),
    });
    return response;
  }

  async getLedger() {
    return this._read();
  }

  async getTrialBalance() {
    return {
      merchantId: this.merchantId,
      currency: "KES",
      generatedAt: new Date().toISOString(),
      accounts: [],
      totalDebits: 0,
      totalCredits: 0,
      balanced: true,
    };
  }

  async replaceLedger(nextState, action = "Replaced ledger state") {
    const state = withAudit(normalizeState(nextState), action);
    await this._persist(state);
    return { state, message: action };
  }

  async resetDemo() {
    const state = withAudit(createSeedData(), "Reset demo ledger");
    await this._persist(state);
    return { state, message: "Demo data reset" };
  }

  async createOrder(order) {
    return this._mutate(`Captured order for ${order.customerName}`, (draft) => {
      draft.orders = [{ ...order, id: order.id || uid("ord") }, ...draft.orders];
      if (order.agent && !draft.agents.includes(order.agent)) {
        draft.agents.push(order.agent);
      }
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

    return this._mutate("Imported M-PESA transactions", (draft) => {
      const existingReceipts = new Set(
        draft.payments.map((payment) => String(payment.receipt).toLowerCase())
      );
      const fresh = parsed.filter(
        (payment) => !existingReceipts.has(String(payment.receipt).toLowerCase())
      );

      if (!fresh.length) {
        return {
          imported: 0,
          message: "No new M-PESA transactions found",
          skipWrite: true,
        };
      }

      const action = `Imported ${fresh.length} M-PESA transactions`;

      return {
        action,
        imported: fresh.length,
        apply() {
          draft.payments = [...fresh, ...draft.payments];
        },
      };
    });
  }

  async matchPayment(paymentId, orderId) {
    return this._mutate(`Matched payment ${shortId(paymentId)}`, (draft) => {
      const payment = findById(draft.payments, paymentId, "payment");
      findById(draft.orders, orderId, "order");
      payment.orderId = orderId;
      payment.status = "matched";
      payment.classification =
        payment.classification === "unknown" ? "product_sale" : payment.classification;
    });
  }

  async classifyPayment(paymentId, classification) {
    return this._mutate(`Classified payment as ${titleCase(classification)}`, (draft) => {
      const payment = findById(draft.payments, paymentId, "payment");
      payment.orderId = "";
      payment.classification = classification;
      payment.status = "classified";
    });
  }

  async unmatchPayment(paymentId) {
    return this._mutate(`Unmatched payment ${shortId(paymentId)}`, (draft) => {
      const payment = findById(draft.payments, paymentId, "payment");
      payment.orderId = "";
      payment.status = "unmatched";
      payment.classification = "unknown";
    });
  }

  async updateOrder(orderId, patch) {
    return this._mutate("Updated order", (draft) => {
      const order = findById(draft.orders, orderId, "order");
      Object.assign(order, patch);
    });
  }

  async markFollowUp(orderId) {
    return this._mutate("Marked follow-up complete", (draft) => {
      const order = findById(draft.orders, orderId, "order");
      order.lastFollowUpAt = new Date().toISOString();
    });
  }

  async addInventoryItem(item) {
    return this._mutate(`Added inventory item ${item.sku}`, (draft) => {
      draft.inventory = [{ ...item, id: item.id || uid("sku") }, ...draft.inventory];
    });
  }

  async restockItem(itemId, quantity) {
    return this._mutate("Restocked inventory item", (draft) => {
      const item = findById(draft.inventory, itemId, "inventory item");
      item.onHand += Number(quantity) || 0;
    });
  }

  async _mutate(action, updater) {
    return this._serialize(() =>
      this._runMutation(action, updater, {
        read: () => this._read(),
        write: (state) => this._write(state),
      })
    );
  }

  async _read() {
    try {
      const raw = await fs.readFile(this.dataFile, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const seeded = withAudit(createSeedData(), "Initialized demo ledger");
      await this._write(seeded);
      return seeded;
    }
  }

  async _write(state) {
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    const tempFile = `${this.dataFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`);
    await fs.rename(tempFile, this.dataFile);
  }

  async _persist(state) {
    return this._serialize(() => this._write(state));
  }

  async _serialize(operation) {
    const run = this.writeQueue.then(operation, operation);
    this.writeQueue = run.catch(() => {});
    return run;
  }

  async _runMutation(action, updater, access) {
    const state = await access.read();
    const mutation = updater(state) || {};

    if (mutation.skipWrite) {
      return {
        state,
        imported: mutation.imported,
        message: mutation.message || action,
      };
    }

    mutation.apply?.();
    const nextAction = mutation.action || action;
    const nextState = withAudit(state, nextAction);
    await access.write(nextState);
    return {
      state: nextState,
      imported: mutation.imported,
      message: nextAction,
    };
  }
}

export function normalizeState(state) {
  return {
    merchant: state.merchant || {
      name: "Pilot Merchant",
      till: "Buy Goods 542842",
      segment: "Social seller",
      currency: "KES",
    },
    agents: Array.isArray(state.agents) ? state.agents : [],
    inventory: Array.isArray(state.inventory) ? state.inventory : [],
    orders: Array.isArray(state.orders) ? state.orders : [],
    payments: Array.isArray(state.payments) ? state.payments : [],
    auditLog: Array.isArray(state.auditLog) ? state.auditLog : [],
    createdAt: state.createdAt || new Date().toISOString(),
    updatedAt: state.updatedAt || new Date().toISOString(),
  };
}

export function withAudit(state, action, actor = "Owner") {
  const now = new Date().toISOString();
  return {
    ...normalizeState(state),
    updatedAt: now,
    auditLog: [
      {
        id: uid("audit"),
        at: now,
        actor,
        action,
      },
      ...(state.auditLog || []),
    ].slice(0, 200),
  };
}

function findById(collection, id, label) {
  const item = collection.find((entry) => entry.id === id);
  if (!item) {
    const error = new Error(`${titleCase(label)} not found`);
    error.statusCode = 404;
    throw error;
  }
  return item;
}

function titleCase(value = "") {
  return String(value)
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.slice(1));
}

function shortId(value = "") {
  return String(value).slice(-8);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function idempotencyConflictError() {
  const error = new Error("Idempotency key was already used for a different request");
  error.statusCode = 409;
  error.code = "CONFLICT";
  return error;
}
