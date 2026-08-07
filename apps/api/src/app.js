import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import crypto from "node:crypto";
import {
  buildReconciliation,
  dailyOwnerReport,
  deriveOrder,
  getAgentMetrics,
  getCustomerProfiles,
  getFollowUps,
  getInventoryRows,
  getSummary,
  toCsv,
} from "@dukaspot/core";
import {
  classifyPaymentSchema,
  inventoryItemSchema,
  matchPaymentSchema,
  orderPatchSchema,
  orderSchema,
  parseBody,
  paymentImportSchema,
  restockSchema,
} from "./validation.js";

export function createApp({ repository, config }) {
  if (!repository) throw new Error("createApp requires repository");

  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const requestId = request.get("x-request-id") || crypto.randomUUID();
    request.id = requestId;
    response.set("x-request-id", requestId);
    next();
  });
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config?.corsOrigins?.includes("*") || config?.corsOrigins?.includes(origin)) {
          callback(null, true);
          return;
        }
        const error = new Error("Origin is not allowed by CORS");
        error.statusCode = 403;
        callback(error);
      },
    })
  );
  if (config?.nodeEnv !== "test") {
    app.use(morgan(config?.nodeEnv === "production" ? "combined" : "dev"));
  }

  app.get("/api/health", async (_request, response) => {
    response.json({
      ok: true,
      service: "dukaspot-api",
      version: "0.9.5",
      persistence: config?.databaseUrl ? "postgres" : "file",
      checkedAt: new Date().toISOString(),
    });
  });

  app.get("/api/ready", asyncRoute(async (_request, response) => {
    await repository.getLedger();
    response.json({
      ok: true,
      service: "dukaspot-api",
      persistence: config?.databaseUrl ? "postgres" : "file",
      checkedAt: new Date().toISOString(),
    });
  }));

  app.get("/api/ledger", asyncRoute(async (_request, response) => {
    response.json(presentLedger(await repository.getLedger()));
  }));

  app.post("/api/orders", asyncRoute(async (request, response) => {
    const order = parseBody(orderSchema, request.body);
    const result = await repository.createOrder({
      ...order,
      createdAt: order.createdAt || new Date().toISOString(),
      lastFollowUpAt: order.lastFollowUpAt || "",
    });
    response.status(201).json(presentResult(result));
  }));

  app.patch("/api/orders/:orderId", asyncRoute(async (request, response) => {
    const patch = parseBody(orderPatchSchema, request.body);
    const result = await repository.updateOrder(request.params.orderId, patch);
    response.json(presentResult(result));
  }));

  app.post("/api/orders/:orderId/follow-up", asyncRoute(async (request, response) => {
    const result = await repository.markFollowUp(request.params.orderId);
    response.json(presentResult(result));
  }));

  app.post("/api/payments/import", asyncRoute(async (request, response) => {
    const { csv } = parseBody(paymentImportSchema, request.body);
    const result = await repository.importPayments(csv);
    response.status(result.imported ? 201 : 200).json(presentResult(result));
  }));

  app.post("/api/payments/:paymentId/match", asyncRoute(async (request, response) => {
    const { orderId } = parseBody(matchPaymentSchema, request.body);
    const result = await repository.matchPayment(request.params.paymentId, orderId);
    response.json(presentResult(result));
  }));

  app.post("/api/payments/:paymentId/classify", asyncRoute(async (request, response) => {
    const { classification } = parseBody(classifyPaymentSchema, request.body);
    const result = await repository.classifyPayment(
      request.params.paymentId,
      classification
    );
    response.json(presentResult(result));
  }));

  app.post("/api/payments/:paymentId/unmatch", asyncRoute(async (request, response) => {
    const result = await repository.unmatchPayment(request.params.paymentId);
    response.json(presentResult(result));
  }));

  app.post("/api/inventory", asyncRoute(async (request, response) => {
    const item = parseBody(inventoryItemSchema, request.body);
    const result = await repository.addInventoryItem(item);
    response.status(201).json(presentResult(result));
  }));

  app.post("/api/inventory/:itemId/restock", asyncRoute(async (request, response) => {
    const { quantity } = parseBody(restockSchema, request.body);
    const result = await repository.restockItem(request.params.itemId, quantity);
    response.json(presentResult(result));
  }));

  app.post("/api/demo/reset", asyncRoute(async (_request, response) => {
    const result = await repository.resetDemo();
    response.json(presentResult(result));
  }));

  app.get("/api/reports/daily", asyncRoute(async (_request, response) => {
    const state = await repository.getLedger();
    response.type("text/plain").send(dailyOwnerReport(state));
  }));

  app.get("/api/exports/orders.csv", asyncRoute(async (_request, response) => {
    const state = await repository.getLedger();
    const rows = state.orders.map((order) => {
      const derived = deriveOrder(order, state.payments);
      return {
        id: order.id,
        createdAt: order.createdAt,
        customerName: order.customerName,
        phone: order.phone,
        productName: order.productName,
        variant: order.variant,
        quantity: order.quantity,
        total: derived.total,
        paidAmount: derived.paidAmount,
        balance: derived.balance,
        stage: order.stage,
        paymentStatus: derived.computedPaymentStatus,
        agent: order.agent,
        source: order.source,
        location: order.location,
        grossProfit: derived.grossProfit,
      };
    });
    response
      .type("text/csv")
      .attachment("dukaspot-orders.csv")
      .send(
        toCsv(rows, [
          { key: "id", label: "Order ID" },
          { key: "createdAt", label: "Created At" },
          { key: "customerName", label: "Customer" },
          { key: "phone", label: "Phone" },
          { key: "productName", label: "Product" },
          { key: "variant", label: "Variant" },
          { key: "quantity", label: "Quantity" },
          { key: "total", label: "Total" },
          { key: "paidAmount", label: "Paid" },
          { key: "balance", label: "Balance" },
          { key: "stage", label: "Stage" },
          { key: "paymentStatus", label: "Payment Status" },
          { key: "agent", label: "Agent" },
          { key: "source", label: "Source" },
          { key: "location", label: "Location" },
          { key: "grossProfit", label: "Gross Profit" },
        ])
      );
  }));

  app.get("/api/exports/payments.csv", asyncRoute(async (_request, response) => {
    const state = await repository.getLedger();
    response
      .type("text/csv")
      .attachment("dukaspot-payments.csv")
      .send(
        toCsv(state.payments, [
          { key: "receipt", label: "Receipt" },
          { key: "receivedAt", label: "Received At" },
          { key: "payerName", label: "Payer" },
          { key: "phone", label: "Phone" },
          { key: "amount", label: "Amount" },
          { key: "classification", label: "Classification" },
          { key: "status", label: "Status" },
          { key: "orderId", label: "Order ID" },
          { key: "details", label: "Details" },
        ])
      );
  }));

  app.use((_request, response) => {
    response.status(404).json({ error: "Route not found" });
  });

  app.use((error, _request, response, _next) => {
    const statusCode = error.statusCode || 500;
    response.status(statusCode).json({
      error: statusCode >= 500 ? "Internal server error" : error.message,
      details: error.details,
    });
  });

  return app;
}

function asyncRoute(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

function presentResult(result) {
  return {
    message: result.message,
    imported: result.imported,
    ...presentLedger(result.state),
  };
}

function presentLedger(state) {
  return {
    state,
    summary: getSummary(state),
    reconciliation: buildReconciliation(state.orders, state.payments),
    inventoryRows: getInventoryRows(state.inventory, state.orders, state.payments),
    followUps: getFollowUps(state.orders, state.payments),
    customers: getCustomerProfiles(state.orders, state.payments),
    agents: getAgentMetrics(state.orders, state.payments),
    ownerReport: dailyOwnerReport(state),
  };
}
