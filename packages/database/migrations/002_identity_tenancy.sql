create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_role') then
    create type membership_role as enum (
      'PLATFORM_SUPER_ADMIN',
      'MERCHANT_OWNER',
      'MERCHANT_ADMIN',
      'FINANCE_MANAGER',
      'SALES_MANAGER',
      'SALES_AGENT',
      'INVENTORY_MANAGER',
      'FULFILMENT_AGENT',
      'ACCOUNTANT',
      'READ_ONLY_AUDITOR'
    );
  end if;
end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text,
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_lowercase check (email = lower(email)),
  constraint users_email_not_blank check (length(trim(email)) > 0),
  constraint users_name_not_blank check (length(trim(name)) > 0)
);

create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  legal_name text not null,
  trading_name text not null,
  currency text not null default 'KES',
  time_zone text not null default 'Africa/Nairobi',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchants_slug_not_blank check (length(trim(slug)) > 0),
  constraint merchants_trading_name_not_blank check (length(trim(trading_name)) > 0),
  constraint merchants_currency_kes check (currency = 'KES')
);

create table if not exists merchant_memberships (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role membership_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, user_id)
);

create index if not exists merchant_memberships_user_id_idx
  on merchant_memberships (user_id);

create index if not exists merchant_memberships_user_active_idx
  on merchant_memberships (user_id, active);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sessions_token_hash_not_blank check (length(trim(token_hash)) > 0)
);

create index if not exists sessions_user_id_idx
  on sessions (user_id);

create index if not exists sessions_active_idx
  on sessions (token_hash, expires_at)
  where revoked_at is null;
