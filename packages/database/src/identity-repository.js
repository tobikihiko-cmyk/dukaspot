import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const OWNER_ROLE = "MERCHANT_OWNER";

export class FileIdentityRepository {
  constructor({ dataFile } = {}) {
    if (!dataFile) throw new Error("FileIdentityRepository requires dataFile");
    this.dataFile = dataFile;
    this.writeQueue = Promise.resolve();
  }

  async createOwnerAccount(input) {
    return this._mutate((store) => {
      const email = normalizeEmail(input.email);
      if (store.users.some((user) => user.email === email)) {
        throw conflictError("Email is already registered");
      }

      const now = new Date().toISOString();
      const user = {
        id: crypto.randomUUID(),
        email,
        name: input.name.trim(),
        passwordHash: input.passwordHash,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      };
      const merchant = {
        id: crypto.randomUUID(),
        slug: uniqueSlug(store.merchants, input.merchantName),
        legalName: (input.legalName || input.merchantName).trim(),
        tradingName: input.merchantName.trim(),
        currency: "KES",
        timeZone: "Africa/Nairobi",
        createdAt: now,
        updatedAt: now,
      };
      const membership = {
        id: crypto.randomUUID(),
        merchantId: merchant.id,
        userId: user.id,
        role: OWNER_ROLE,
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      store.users.push(user);
      store.merchants.push(merchant);
      store.memberships.push(membership);

      return { user: publicUser(user), merchant, membership };
    });
  }

  async findUserByEmail(email) {
    const store = await this._read();
    const user = store.users.find((entry) => entry.email === normalizeEmail(email));
    return user ? clone(user) : null;
  }

  async createSession(input) {
    return this._mutate((store) => {
      const user = store.users.find((entry) => entry.id === input.userId);
      if (!user) throw notFoundError("User not found");
      const now = new Date().toISOString();
      const session = {
        id: crypto.randomUUID(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null,
        createdAt: now,
      };
      store.sessions.push(session);
      return clone(session);
    });
  }

  async getSessionByTokenHash(tokenHash) {
    const store = await this._read();
    const session = store.sessions.find((entry) => entry.tokenHash === tokenHash);
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) {
      return null;
    }
    const user = store.users.find((entry) => entry.id === session.userId);
    if (!user) return null;
    const memberships = membershipsForUser(store, user.id);
    return { session: clone(session), user: publicUser(user), memberships };
  }

  async revokeSessionByTokenHash(tokenHash) {
    return this._mutate((store) => {
      const session = store.sessions.find((entry) => entry.tokenHash === tokenHash);
      if (!session || session.revokedAt) return false;
      session.revokedAt = new Date().toISOString();
      return true;
    });
  }

  async getMembershipForUser(userId, merchantId) {
    const store = await this._read();
    const membership = store.memberships.find(
      (entry) => entry.userId === userId && entry.merchantId === merchantId && entry.active
    );
    if (!membership) throw tenantDeniedError();
    const merchant = store.merchants.find((entry) => entry.id === merchantId);
    if (!merchant) throw tenantDeniedError();
    return { ...clone(membership), merchant: clone(merchant) };
  }

  async listMembershipsForUser(userId) {
    const store = await this._read();
    return membershipsForUser(store, userId);
  }

  async _mutate(mutator) {
    return this._serialize(async () => {
      const store = await this._read();
      const result = mutator(store);
      await this._write(store);
      return result;
    });
  }

  async _read() {
    try {
      const raw = await fs.readFile(this.dataFile, "utf8");
      return normalizeStore(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return normalizeStore({});
    }
  }

  async _write(store) {
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    const tempFile = `${this.dataFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(normalizeStore(store), null, 2)}\n`);
    await fs.rename(tempFile, this.dataFile);
  }

  async _serialize(operation) {
    const run = this.writeQueue.then(operation, operation);
    this.writeQueue = run.catch(() => {});
    return run;
  }
}

export class PostgresIdentityRepository {
  constructor({ connectionString } = {}) {
    if (!connectionString) throw new Error("PostgresIdentityRepository requires connectionString");
    this.pool = new Pool({
      connectionString,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async createOwnerAccount(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const email = normalizeEmail(input.email);
      const existing = await client.query("select 1 from users where email = $1", [email]);
      if (existing.rowCount) throw conflictError("Email is already registered");

      const userResult = await client.query(
        `
          insert into users (email, name, password_hash)
          values ($1, $2, $3)
          returning id, email, name, password_hash, email_verified, created_at, updated_at
        `,
        [email, input.name.trim(), input.passwordHash]
      );
      const merchantResult = await client.query(
        `
          insert into merchants (slug, legal_name, trading_name)
          values ($1, $2, $3)
          returning id, slug, legal_name, trading_name, currency, time_zone, created_at, updated_at
        `,
        [
          await uniquePostgresSlug(client, input.merchantName),
          (input.legalName || input.merchantName).trim(),
          input.merchantName.trim(),
        ]
      );
      const membershipResult = await client.query(
        `
          insert into merchant_memberships (merchant_id, user_id, role)
          values ($1, $2, $3)
          returning id, merchant_id, user_id, role, active, created_at, updated_at
        `,
        [merchantResult.rows[0].id, userResult.rows[0].id, OWNER_ROLE]
      );

      await client.query("commit");
      return {
        user: mapPgUser(userResult.rows[0], false),
        merchant: mapPgMerchant(merchantResult.rows[0]),
        membership: mapPgMembership(membershipResult.rows[0]),
      };
    } catch (error) {
      await client.query("rollback");
      if (error?.code === "23505") throw conflictError("Identity record already exists");
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByEmail(email) {
    const result = await this.pool.query(
      "select id, email, name, password_hash, email_verified, created_at, updated_at from users where email = $1",
      [normalizeEmail(email)]
    );
    return result.rowCount ? mapPgUser(result.rows[0], true) : null;
  }

  async createSession(input) {
    const result = await this.pool.query(
      `
        insert into sessions (user_id, token_hash, expires_at)
        values ($1, $2, $3)
        returning id, user_id, token_hash, expires_at, revoked_at, created_at
      `,
      [input.userId, input.tokenHash, input.expiresAt]
    );
    return mapPgSession(result.rows[0]);
  }

  async getSessionByTokenHash(tokenHash) {
    const sessionResult = await this.pool.query(
      `
        select id, user_id, token_hash, expires_at, revoked_at, created_at
        from sessions
        where token_hash = $1
          and revoked_at is null
          and expires_at > now()
      `,
      [tokenHash]
    );
    if (!sessionResult.rowCount) return null;

    const userResult = await this.pool.query(
      "select id, email, name, email_verified, created_at, updated_at from users where id = $1",
      [sessionResult.rows[0].user_id]
    );
    if (!userResult.rowCount) return null;

    return {
      session: mapPgSession(sessionResult.rows[0]),
      user: mapPgUser(userResult.rows[0], false),
      memberships: await this.listMembershipsForUser(userResult.rows[0].id),
    };
  }

  async revokeSessionByTokenHash(tokenHash) {
    const result = await this.pool.query(
      "update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
      [tokenHash]
    );
    return Boolean(result.rowCount);
  }

  async getMembershipForUser(userId, merchantId) {
    const result = await this.pool.query(
      `
        select
          mm.id,
          mm.merchant_id,
          mm.user_id,
          mm.role,
          mm.active,
          mm.created_at,
          mm.updated_at,
          m.id as merchant_record_id,
          m.slug as merchant_slug,
          m.legal_name as merchant_legal_name,
          m.trading_name as merchant_trading_name,
          m.currency as merchant_currency,
          m.time_zone as merchant_time_zone,
          m.created_at as merchant_created_at,
          m.updated_at as merchant_updated_at
        from merchant_memberships mm
        join merchants m on m.id = mm.merchant_id
        where mm.user_id = $1
          and mm.merchant_id = $2
          and mm.active = true
      `,
      [userId, merchantId]
    );
    if (!result.rowCount) throw tenantDeniedError();
    return mapMembershipWithMerchant(result.rows[0]);
  }

  async listMembershipsForUser(userId) {
    const result = await this.pool.query(
      `
        select
          mm.id,
          mm.merchant_id,
          mm.user_id,
          mm.role,
          mm.active,
          mm.created_at,
          mm.updated_at,
          m.id as merchant_record_id,
          m.slug as merchant_slug,
          m.legal_name as merchant_legal_name,
          m.trading_name as merchant_trading_name,
          m.currency as merchant_currency,
          m.time_zone as merchant_time_zone,
          m.created_at as merchant_created_at,
          m.updated_at as merchant_updated_at
        from merchant_memberships mm
        join merchants m on m.id = mm.merchant_id
        where mm.user_id = $1
          and mm.active = true
        order by mm.created_at asc
      `,
      [userId]
    );
    return result.rows.map(mapMembershipWithMerchant);
  }
}

export function normalizeStore(store) {
  return {
    users: Array.isArray(store.users) ? store.users : [],
    merchants: Array.isArray(store.merchants) ? store.merchants : [],
    memberships: Array.isArray(store.memberships) ? store.memberships : [],
    sessions: Array.isArray(store.sessions) ? store.sessions : [],
  };
}

function membershipsForUser(store, userId) {
  return store.memberships
    .filter((membership) => membership.userId === userId && membership.active)
    .map((membership) => {
      const merchant = store.merchants.find((entry) => entry.id === membership.merchantId);
      if (!merchant) return null;
      return { ...clone(membership), merchant: clone(merchant) };
    })
    .filter(Boolean);
}

async function uniquePostgresSlug(client, name) {
  const base = slugify(name);
  for (let index = 0; index < 100; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const result = await client.query("select 1 from merchants where slug = $1", [slug]);
    if (!result.rowCount) return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function uniqueSlug(merchants, name) {
  const base = slugify(name);
  const existing = new Set(merchants.map((merchant) => merchant.slug));
  for (let index = 0; index < 100; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    if (!existing.has(slug)) return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `merchant-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function publicUser(user) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return clone(rest);
}

function mapPgUser(row, includePasswordHash) {
  const user = {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.email_verified,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  if (includePasswordHash) user.passwordHash = row.password_hash;
  return user;
}

function mapPgMerchant(row) {
  return {
    id: row.id,
    slug: row.slug,
    legalName: row.legal_name,
    tradingName: row.trading_name,
    currency: row.currency,
    timeZone: row.time_zone,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPgMembership(row) {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    userId: row.user_id,
    role: row.role,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapMembershipWithMerchant(row) {
  return {
    ...mapPgMembership(row),
    merchant: {
      id: row.merchant_record_id,
      slug: row.merchant_slug,
      legalName: row.merchant_legal_name,
      tradingName: row.merchant_trading_name,
      currency: row.merchant_currency,
      timeZone: row.merchant_time_zone,
      createdAt: toIso(row.merchant_created_at),
      updatedAt: toIso(row.merchant_updated_at),
    },
  };
}

function mapPgSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function conflictError(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = "CONFLICT";
  return error;
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
