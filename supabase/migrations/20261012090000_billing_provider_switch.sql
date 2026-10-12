-- A saved card belongs to the provider that saved it. When a client's billing moves to another provider (the
-- demo's seeded clients have simulator cards, new checkouts go through Stripe), the old card is dropped instead
-- of being kept next to the new customer, where an off-session charge would send a simulator card to Stripe.

create or replace function public.cmd_save_billing(
  p_tenant_id uuid,
  p_client_id uuid,
  p_provider public.payment_provider,
  p_customer_ref text,
  p_card jsonb default null
) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.tenant_id = p_tenant_id) then
    raise exception 'unknown client' using errcode = 'no_data_found';
  end if;

  insert into public.client_billing as cb (
    tenant_id, client_id, provider, customer_ref,
    payment_method_ref, card_brand, card_last4, card_exp_month, card_exp_year
  )
  values (
    p_tenant_id, p_client_id, p_provider, p_customer_ref,
    p_card ->> 'payment_method_ref', p_card ->> 'brand', p_card ->> 'last4',
    (p_card ->> 'exp_month')::smallint, (p_card ->> 'exp_year')::smallint
  )
  on conflict (tenant_id, client_id) do update
  set provider = excluded.provider,
      customer_ref = excluded.customer_ref,
      payment_method_ref = case when cb.provider = excluded.provider
        then coalesce(excluded.payment_method_ref, cb.payment_method_ref) else excluded.payment_method_ref end,
      card_brand = case when cb.provider = excluded.provider
        then coalesce(excluded.card_brand, cb.card_brand) else excluded.card_brand end,
      card_last4 = case when cb.provider = excluded.provider
        then coalesce(excluded.card_last4, cb.card_last4) else excluded.card_last4 end,
      card_exp_month = case when cb.provider = excluded.provider
        then coalesce(excluded.card_exp_month, cb.card_exp_month) else excluded.card_exp_month end,
      card_exp_year = case when cb.provider = excluded.provider
        then coalesce(excluded.card_exp_year, cb.card_exp_year) else excluded.card_exp_year end;
end;
$$;
