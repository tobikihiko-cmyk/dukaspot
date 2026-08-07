do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'journal_lines_one_sided_amount'
  ) then
    alter table journal_lines
      add constraint journal_lines_one_sided_amount
      check (
        (debit_minor > 0 and credit_minor = 0)
        or (credit_minor > 0 and debit_minor = 0)
      );
  end if;
end $$;

create index if not exists journal_lines_merchant_entry_idx
  on journal_lines (merchant_id, journal_entry_id);
