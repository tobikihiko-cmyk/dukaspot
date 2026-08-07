import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileIdentityRepository } from "../src/index.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dukaspot-identity-"));
const repository = new FileIdentityRepository({
  dataFile: path.join(tempDir, "identity.json"),
});

const alice = await repository.createOwnerAccount({
  email: "ALICE@Example.com",
  name: "Alice Owner",
  passwordHash: "hash_alice",
  merchantName: "Alice Threads",
});
assert.equal(alice.user.email, "alice@example.com");
assert.equal(alice.membership.role, "MERCHANT_OWNER");
assert.equal(alice.membership.merchantId, alice.merchant.id);

const bob = await repository.createOwnerAccount({
  email: "bob@example.com",
  name: "Bob Owner",
  passwordHash: "hash_bob",
  merchantName: "Bob Beauty",
});

await assert.rejects(
  () =>
    repository.createOwnerAccount({
      email: "alice@example.com",
      name: "Alice Again",
      passwordHash: "hash_other",
      merchantName: "Other Shop",
    }),
  { code: "CONFLICT", statusCode: 409 }
);

const aliceUser = await repository.findUserByEmail("alice@example.com");
assert.equal(aliceUser.passwordHash, "hash_alice");

const session = await repository.createSession({
  userId: alice.user.id,
  tokenHash: "token_hash_alice",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
assert.equal(session.userId, alice.user.id);

const activeSession = await repository.getSessionByTokenHash("token_hash_alice");
assert.equal(activeSession.user.email, "alice@example.com");
assert.equal(activeSession.memberships.length, 1);
assert.equal(activeSession.memberships[0].merchant.id, alice.merchant.id);

const aliceTenant = await repository.getMembershipForUser(alice.user.id, alice.merchant.id);
assert.equal(aliceTenant.merchant.tradingName, "Alice Threads");

await assert.rejects(
  () => repository.getMembershipForUser(alice.user.id, bob.merchant.id),
  { code: "TENANT_ACCESS_DENIED", statusCode: 403 }
);

assert.equal(await repository.revokeSessionByTokenHash("token_hash_alice"), true);
assert.equal(await repository.getSessionByTokenHash("token_hash_alice"), null);

console.log("PASS file identity repository auth and tenancy workflow");
