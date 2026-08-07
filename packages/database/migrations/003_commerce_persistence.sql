create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum (
      'DRAFT',
      'QUOTATION',
      'RESERVED',
      'CONFIRMED',
      'PARTIALLY_PAID',
      'PAID',
      'PROCESSING',
      'DISPATCHED',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
      'PARTIALLY_REFUNDED',
      'FAILED_FULFILMENT'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'inventory_movement_type') then
    create type inventory_movement_type as enum (
      'OPENING_STOCK',
      'PURCHASE',
      'SALE_RESERVATION',
      'RESERVATION_RELEASE',
      'SALE_FULFILMENT',
      'CUSTOMER_RETURN',
      'SUPPLIER_RETURN',
      'DAMAGE',
      'ADJUSTMENT',
      'BRANCH_TRANSFER',
      'STOCK_COUNT_CORRECTION'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_provider') then
    create type payment_provider as enum (
      'MPESA_STK',
      'MPESA_TILL',
      'MPESA_PAYBILL',
      'POCHI',
      'BANK',
      'CASH',
      'CASH_ON_DELIVERY',
      'CARD'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum (
      'UNMATCHED',
      'PARTIALLY_ALLOCATED',
      'ALLOCATED',
      'CLASSIFIED',
      'DUPLICATE',
      'REVERSED',
      'REFUNDED',
      'FAILED'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'journal_entry_status') then
    create type journal_entry_status as enum ('POSTED', 'REVERSED');
  end if;
end $$;

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, name),
  constraint branches_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists branches_merchant_id_idx on branches (merchant_id);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  display_name text not null,
  primary_phone text,
  whatsapp_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, primary_phone),
  constraint customers_display_name_not_blank check (length(trim(display_name)) > 0)
);

create index if not exists customers_merchant_display_name_idx
  on customers (merchant_id, display_name);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  name text not null,
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, name),
  constraint products_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists products_merchant_id_idx on products (merchant_id);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  external_id text,
  sku text not null,
  name text not null,
  selling_price_minor bigint not null,
  cost_price_minor bigint not null,
  reorder_point integer not null default 0,
  opening_stock integer not null default 0,
  currency text not null default 'KES',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, sku),
  unique (merchant_id, external_id),
  constraint product_variants_sku_not_blank check (length(trim(sku)) > 0),
  constraint product_variants_name_not_blank check (length(trim(name)) > 0),
  constraint product_variants_currency_kes check (currency = 'KES')
);

create index if not exists product_variants_merchant_product_idx
  on product_variants (merchant_id, product_id);

create table if not exists inventory_locations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  branch_id uuid references branches(id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, name),
  constraint inventory_locations_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists inventory_locations_merchant_branch_idx
  on inventory_locations (merchant_id, branch_id);

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  variant_id uuid not null references product_variants(id),
  location_id uuid not null references inventory_locations(id),
  movement_type inventory_movement_type not null,
  quantity integer not null,
  source_event_id text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (merchant_id, source_event_id)
);

create index if not exists inventory_movements_merchant_variant_location_idx
  on inventory_movements (merchant_id, variant_id, location_id);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  customer_id uuid references customers(id),
  branch_id uuid references branches(id),
  order_number text not null,
  status order_status not null default 'DRAFT',
  stage text not null default 'confirmed',
  payment_status text not null default 'unpaid',
  currency text not null default 'KES',
  total_minor bigint not null,
  delivery_fee_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  source text not null default 'WhatsApp',
  location text not null default '',
  agent text not null default 'Unassigned',
  notes text not null default '',
  last_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, order_number),
  constraint orders_order_number_not_blank check (length(trim(order_number)) > 0),
  constraint orders_currency_kes check (currency = 'KES')
);

create index if not exists orders_merchant_customer_idx
  on orders (merchant_id, customer_id);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  variant_id uuid references product_variants(id),
  description text not null,
  quantity integer not null,
  unit_selling_price_minor bigint not null,
  unit_cost_minor bigint not null,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  constraint order_items_quantity_positive check (quantity > 0)
);

create index if not exists order_items_merchant_order_idx
  on order_items (merchant_id, order_id);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  external_id text not null,
  provider payment_provider not null,
  receipt text,
  payer_phone text,
  payer_name text,
  amount_minor bigint not null,
  currency text not null default 'KES',
  status payment_status not null default 'UNMATCHED',
  classification text not null default 'unknown',
  details text not null default '',
  received_at timestamptz not null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, external_id),
  unique (merchant_id, provider, receipt),
  constraint payments_external_id_not_blank check (length(trim(external_id)) > 0),
  constraint payments_currency_kes check (currency = 'KES')
);

create index if not exists payments_merchant_status_idx
  on payments (merchant_id, status);

create table if not exists payment_allocations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  payment_id uuid not null references payments(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  amount_minor bigint not null,
  rule text not null,
  confidence integer not null,
  explanation text not null,
  created_at timestamptz not null default now(),
  unique (merchant_id, payment_id, order_id)
);

create index if not exists payment_allocations_merchant_order_idx
  on payment_allocations (merchant_id, order_id);

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  source_event_id text not null,
  currency text not null default 'KES',
  status journal_entry_status not null default 'POSTED',
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (merchant_id, source_event_id)
);

create index if not exists journal_entries_merchant_posted_idx
  on journal_entries (merchant_id, posted_at);

create table if not exists journal_lines (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  account_code text not null,
  debit_minor bigint not null default 0,
  credit_minor bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists journal_lines_merchant_account_idx
  on journal_lines (merchant_id, account_code);

create table if not exists outbox_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (merchant_id, idempotency_key)
);

create index if not exists outbox_events_merchant_published_idx
  on outbox_events (merchant_id, published_at);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  provider text not null,
  provider_event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists webhook_events_merchant_processed_idx
  on webhook_events (merchant_id, processed_at);

create table if not exists idempotency_records (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  idempotency_key text not null,
  method text not null,
  path text not null,
  request_hash text not null,
  status_code integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  unique (merchant_id, idempotency_key),
  constraint idempotency_key_not_blank check (length(trim(idempotency_key)) > 0)
);

create index if not exists idempotency_records_merchant_created_idx
  on idempotency_records (merchant_id, created_at);
