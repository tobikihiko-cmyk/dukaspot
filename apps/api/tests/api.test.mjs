import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileIdentityRepository, FileLedgerRepository } from "@dukaspot/database";
import { createNestApp } from "../dist/nest-app.js";
import { loadApiConfig } from "@dukaspot/config";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dukaspot-api-"));
const repository = new FileLedgerRepository({
  dataFile: path.join(tempDir, "ledger.json"),
});
const identityRepository = new FileIdentityRepository({
  dataFile: path.join(tempDir, "identity.json"),
});
const app = await createNestApp({
  repository,
  identityRepository,
  config: loadApiConfig({
    NODE_ENV: "test",
    CORS_ORIGIN: "*",
    DUKASPOT_DATA_FILE: path.join(tempDir, "ledger.json"),
    DUKASPOT_IDENTITY_FILE: path.join(tempDir, "identity.json"),
  }),
});

await app.listen(0, "127.0.0.1");
const server = app.getHttpServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  const health = await request("/api/health");
  assert.equal(health.ok, true);

  const ready = await request("/api/ready");
  assert.equal(ready.ok, true);

  const openApi = await request("/api/openapi.json");
  assert.equal(openApi.openapi, "3.1.0");
  assert.ok(openApi.paths["/api/v1/ledger"]);
  assert.ok(openApi.paths["/api/v1/accounting/trial-balance"]);
  assert.ok(openApi.paths["/api/v1/auth/login"]);
  assert.ok(openApi.paths["/api/v1/auth/csrf"]);

  const missing = await request("/api/not-found", { expectStatus: 404 });
  assert.equal(missing.error.code, "NOT_FOUND");

  const anonymousMe = await request("/api/auth/me", { expectStatus: 401 });
  assert.equal(anonymousMe.error.code, "UNAUTHORIZED");

  const anonymousLedger = await request("/api/ledger", { expectStatus: 401 });
  assert.equal(anonymousLedger.error.code, "UNAUTHORIZED");

  const anonymousTrialBalance = await request("/api/accounting/trial-balance", {
    expectStatus: 401,
  });
  assert.equal(anonymousTrialBalance.error.code, "UNAUTHORIZED");

  const aliceRegister = await request("/api/auth/register", {
    method: "POST",
    body: {
      email: "alice@example.com",
      password: "correct horse battery staple",
      name: "Alice Owner",
      merchantName: "Alice Threads",
    },
    returnResponse: true,
  });
  const alice = aliceRegister.payload;
  const aliceCookie = sessionCookie(aliceRegister.headers);
  assert.equal(alice.user.email, "alice@example.com");
  assert.equal(alice.currentTenant.role, "MERCHANT_OWNER");
  assert.ok(alice.currentTenant.permissions.includes("membership:manage"));
  assert.ok(aliceCookie.includes("dukaspot_session="));

  const bobRegister = await request("/api/auth/register", {
    method: "POST",
    body: {
      email: "bob@example.com",
      password: "another correct horse battery staple",
      name: "Bob Owner",
      merchantName: "Bob Beauty",
    },
    returnResponse: true,
  });
  const bob = bobRegister.payload;

  const me = await request("/api/auth/me", {
    headers: { cookie: aliceCookie },
  });
  assert.equal(me.user.email, "alice@example.com");

  const aliceTenant = await request(`/api/tenants/${alice.currentTenant.merchantId}`, {
    headers: { cookie: aliceCookie },
  });
  assert.equal(aliceTenant.tenant.merchantId, alice.currentTenant.merchantId);

  const deniedTenant = await request(`/api/tenants/${bob.currentTenant.merchantId}`, {
    headers: { cookie: aliceCookie },
    expectStatus: 403,
  });
  assert.equal(deniedTenant.error.code, "TENANT_ACCESS_DENIED");

  const duplicateRegister = await request("/api/auth/register", {
    method: "POST",
    body: {
      email: "alice@example.com",
      password: "correct horse battery staple",
      name: "Alice Duplicate",
      merchantName: "Alice Duplicate Shop",
    },
    expectStatus: 409,
  });
  assert.equal(duplicateRegister.error.code, "CONFLICT");

  const badLogin = await request("/api/auth/login", {
    method: "POST",
    body: {
      email: "alice@example.com",
      password: "wrong password",
    },
    expectStatus: 401,
    returnResponse: true,
  });
  assert.equal(badLogin.payload.error.code, "UNAUTHORIZED");
  assert.equal(badLogin.headers.get("x-ratelimit-limit"), "10");

  const aliceLogin = await request("/api/auth/login", {
    method: "POST",
    body: {
      email: "alice@example.com",
      password: "correct horse battery staple",
      merchantId: alice.currentTenant.merchantId,
    },
    returnResponse: true,
  });
  assert.equal(aliceLogin.payload.currentTenant.merchantId, alice.currentTenant.merchantId);
  const aliceActiveCookie = sessionCookie(aliceLogin.headers);
  assert.ok(aliceActiveCookie.includes("dukaspot_session="));
  const aliceAuth = await csrfSession(aliceActiveCookie);

  const aliceInitialAuth = await csrfSession(aliceCookie);
  const logout = await request("/api/auth/logout", {
    method: "POST",
    headers: csrfHeaders(aliceInitialAuth),
  });
  assert.equal(logout.ok, true);

  const revokedMe = await request("/api/auth/me", {
    headers: { cookie: aliceCookie },
    expectStatus: 401,
  });
  assert.equal(revokedMe.error.code, "UNAUTHORIZED");

  const ledger = await request("/api/ledger", {
    headers: { cookie: aliceActiveCookie },
  });
  assert.equal(ledger.state.orders.length, 5);
  assert.ok(ledger.summary);

  const versionedLedger = await request("/api/v1/ledger", {
    headers: { cookie: aliceActiveCookie },
  });
  assert.equal(versionedLedger.state.orders.length, 5);

  const trialBalance = await request("/api/v1/accounting/trial-balance", {
    headers: { cookie: aliceActiveCookie },
  });
  assert.equal(trialBalance.balanced, true);
  assert.equal(trialBalance.totalDebits, trialBalance.totalCredits);

  const missingCsrf = await request("/api/orders", {
    method: "POST",
    headers: {
      cookie: aliceActiveCookie,
      "idempotency-key": "test-missing-csrf",
    },
    body: {
      customerName: "Missing CSRF Buyer",
      phone: "0712444002",
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
    },
    expectStatus: 403,
  });
  assert.equal(missingCsrf.error.code, "FORBIDDEN");

  const missingIdempotency = await request("/api/orders", {
    method: "POST",
    headers: csrfHeaders(aliceAuth),
    body: {
      customerName: "Missing Key Buyer",
      phone: "0712444002",
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
    },
    expectStatus: 400,
  });
  assert.equal(missingIdempotency.error.code, "BAD_REQUEST");

  const orderIdempotencyKey = "test-order-api-buyer";
  const created = await request("/api/orders", {
    method: "POST",
    headers: {
      ...csrfHeaders(aliceAuth),
      "idempotency-key": orderIdempotencyKey,
    },
    body: {
      customerName: "API Buyer",
      phone: "0712444000",
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
    },
  });
  const order = created.state.orders.find((entry) => entry.customerName === "API Buyer");
  assert.ok(order);
  assert.equal(order.phone, "+254712444000");

  const replayedCreated = await request("/api/orders", {
    method: "POST",
    headers: {
      ...csrfHeaders(aliceAuth),
      "idempotency-key": orderIdempotencyKey,
    },
    body: {
      customerName: "API Buyer",
      phone: "0712444000",
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
    },
    returnResponse: true,
  });
  assert.equal(replayedCreated.headers.get("x-idempotency-replayed"), "true");
  assert.equal(
    replayedCreated.payload.state.orders.filter((entry) => entry.customerName === "API Buyer").length,
    1
  );

  const conflictingIdempotency = await request("/api/orders", {
    method: "POST",
    headers: {
      ...csrfHeaders(aliceAuth),
      "idempotency-key": orderIdempotencyKey,
    },
    body: {
      customerName: "Different Buyer",
      phone: "0712444999",
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
    },
    expectStatus: 409,
  });
  assert.equal(conflictingIdempotency.error.code, "CONFLICT");

  const invalidPatch = await request(`/api/orders/${order.id}`, {
    method: "PATCH",
    headers: {
      ...csrfHeaders(aliceAuth),
      "idempotency-key": "test-invalid-patch",
    },
    body: {},
    expectStatus: 400,
  });
  assert.equal(invalidPatch.error.code, "VALIDATION_FAILED");

  const imported = await request("/api/payments/import", {
    method: "POST",
    headers: {
      ...csrfHeaders(aliceAuth),
      "idempotency-key": "test-import-payments",
    },
    body: {
      csv: [
        "Date,Receipt,Payer,Phone,Paid In,Details",
        "2026-08-06T10:30:00+03:00,QH80API001,API Buyer,0712444000,1050,Received from API Buyer 0712444000",
      ].join("\n"),
    },
  });
  assert.equal(imported.imported, 1);

  const matched = await request("/api/payments/pay_QH80API001/match", {
    method: "POST",
    headers: {
      ...csrfHeaders(aliceAuth),
      "idempotency-key": "test-match-payment",
    },
    body: { orderId: order.id },
  });
  const payment = matched.state.payments.find((entry) => entry.id === "pay_QH80API001");
  assert.equal(payment.orderId, order.id);

  console.log("PASS api auth, tenant isolation, ledger, create, import, match workflow");
} finally {
  await app.close();
}

async function request(pathname, options = {}) {
  const { body, expectStatus, headers, method, returnResponse } = options;
  const requestHeaders = {
    ...(headers || {}),
    ...(body ? { "content-type": "application/json" } : {}),
  };
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: method || "GET",
    headers: Object.keys(requestHeaders).length ? requestHeaders : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (expectStatus) {
    assert.equal(response.status, expectStatus);
    return returnResponse ? { payload, headers: response.headers, status: response.status } : payload;
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  }
  if (returnResponse) {
    return { payload, headers: response.headers, status: response.status };
  }
  return payload;
}

function sessionCookie(headers) {
  return cookiePair(headers, "dukaspot_session");
}

async function csrfSession(cookie) {
  const csrf = await request("/api/auth/csrf", {
    headers: { cookie },
    returnResponse: true,
  });
  assert.equal(typeof csrf.payload.csrfToken, "string");
  return {
    cookie: `${cookie}; ${cookiePair(csrf.headers, "dukaspot_csrf")}`,
    token: csrf.payload.csrfToken,
  };
}

function csrfHeaders(auth) {
  return {
    cookie: auth.cookie,
    "x-csrf-token": auth.token,
  };
}

function cookiePair(headers, name) {
  const cookie = setCookies(headers).find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie, `Missing ${name} cookie`);
  return cookie.split(";")[0];
}

function setCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const setCookie = headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(/,(?=\s*dukaspot_(?:session|csrf)=)/).map((value) => value.trim());
}
