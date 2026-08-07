import assert from "node:assert/strict";
import {
  createSessionToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../dist/index.js";

const passwordHash = await hashPassword("correct horse battery staple");
assert.match(passwordHash, /^\$argon2id\$/);
assert.equal(await verifyPassword(passwordHash, "correct horse battery staple"), true);
assert.equal(await verifyPassword(passwordHash, "wrong password"), false);

const token = createSessionToken();
assert.notEqual(token.rawToken, token.tokenHash);
assert.equal(token.tokenHash, hashToken(token.rawToken));
assert.equal(createSessionToken().rawToken === token.rawToken, false);

console.log("PASS security password hashing and session token helpers");
