import assert from "node:assert/strict";
import {
  assertPermission,
  assertTenantAccess,
  permissionsForRole,
} from "../dist/index.js";

const ownerContext = {
  userId: "user_owner",
  merchantId: "merchant_a",
  membershipId: "membership_owner",
  role: "MERCHANT_OWNER",
  permissions: permissionsForRole("MERCHANT_OWNER"),
};

assert.ok(ownerContext.permissions.includes("membership:manage"));
assert.doesNotThrow(() => assertPermission(ownerContext, "order:write"));
assert.doesNotThrow(() => assertTenantAccess(ownerContext, "merchant_a"));

const auditorContext = {
  userId: "user_auditor",
  merchantId: "merchant_a",
  membershipId: "membership_auditor",
  role: "READ_ONLY_AUDITOR",
  permissions: permissionsForRole("READ_ONLY_AUDITOR"),
};

assert.equal(auditorContext.permissions.includes("order:write"), false);
assert.throws(() => assertPermission(auditorContext, "order:write"), {
  code: "TENANT_ACCESS_DENIED",
  statusCode: 403,
});
assert.throws(() => assertTenantAccess(auditorContext, "merchant_b"), {
  code: "TENANT_ACCESS_DENIED",
  statusCode: 403,
});

console.log("PASS auth permissions and tenant assertions");
