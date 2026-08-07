create table if not exists ledger_states (
  merchant_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists ledger_states_state_gin
  on ledger_states using gin (state);
