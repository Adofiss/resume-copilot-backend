import { createClient } from "@supabase/supabase-js";

// Service-role client: full DB access, server-side only. Never send this
// key to the extension — it bypasses row-level security.
export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

/**
 * Schema (run in Supabase SQL editor):
 *
 * create table public.history (
 *   id uuid primary key default gen_random_uuid(),
 *   user_id uuid references auth.users(id) not null,
 *   job_title text,
 *   company text,
 *   job_url text,
 *   match_percent int,
 *   action text, -- 'score' | 'tailor' | 'cover_letter'
 *   created_at timestamptz default now()
 * );
 *
 * create table public.usage (
 *   id uuid primary key default gen_random_uuid(),
 *   user_id uuid references auth.users(id) not null,
 *   action text not null,
 *   tokens_used int,
 *   created_at timestamptz default now()
 * );
 * alter table public.usage enable row level security;
 * -- No policies added deliberately: only service_role (used by this backend)
 * -- can read/write. anon and authenticated get fully denied by default.
 *
 * alter table public.history enable row level security;
 * create policy "users read own history" on public.history
 *   for select using (auth.uid() = user_id);
 * -- service role bypasses RLS automatically, so inserts from this backend work regardless.
 *
 * -- Pay-per-use credits: 1 credit = 1 tailor OR 1 cover letter action.
 * create table public.credits (
 *   user_id uuid primary key references auth.users(id),
 *   balance int not null default 0,
 *   updated_at timestamptz default now()
 * );
 * alter table public.credits enable row level security;
 * -- service_role only, same reasoning as the usage table above.
 *
 * -- Atomic spend so two concurrent requests can't both succeed off the same last credit.
 * create or replace function spend_credit(p_user_id uuid)
 * returns boolean as $$
 * declare
 *   affected int;
 * begin
 *   update public.credits set balance = balance - 1, updated_at = now()
 *   where user_id = p_user_id and balance > 0;
 *   get diagnostics affected = row_count;
 *   return affected > 0;
 * end;
 * $$ language plpgsql;
 *
 * create or replace function add_credits(p_user_id uuid, p_amount int)
 * returns void as $$
 * begin
 *   insert into public.credits (user_id, balance) values (p_user_id, p_amount)
 *   on conflict (user_id) do update set balance = public.credits.balance + p_amount, updated_at = now();
 * end;
 * $$ language plpgsql;
 *
 * -- Subscription status, synced from Stripe webhooks. Presence of a row with
 * -- status='active' grants unlimited tailor/cover-letter access (see entitlement.js).
 * create table public.subscriptions (
 *   user_id uuid primary key references auth.users(id),
 *   stripe_customer_id text,
 *   stripe_subscription_id text,
 *   status text,
 *   updated_at timestamptz default now()
 * );
 * alter table public.subscriptions enable row level security;
 * -- service_role only, same reasoning as the usage table above.
 */

export async function logHistory(userId, entry) {
  const { error } = await supabase.from("history").insert({ user_id: userId, ...entry });
  if (error) console.error("Failed to log history:", error.message);
}

export async function logUsage(userId, action, tokensUsed) {
  const { error } = await supabase.from("usage").insert({ user_id: userId, action, tokens_used: tokensUsed });
  if (error) console.error("Failed to log usage:", error.message);
}

export async function getCreditBalance(userId) {
  const { data, error } = await supabase.from("credits").select("balance").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data?.balance ?? 0;
}

/** Returns the Stripe customer ID for a subscribed user, or null if they've never subscribed. */
export async function getStripeCustomerId(userId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.stripe_customer_id ?? null;
}

/** Atomically decrements one credit. Returns false if the user had none left. */
export async function spendCredit(userId) {
  const { data, error } = await supabase.rpc("spend_credit", { p_user_id: userId });
  if (error) throw error;
  return Boolean(data); // the SQL function returns true if a credit was successfully spent
}

export async function addCredits(userId, amount) {
  const { error } = await supabase.rpc("add_credits", { p_user_id: userId, p_amount: amount });
  if (error) throw error;
}
export async function getHistory(userId) {
  const { data, error } = await supabase
    .from("history")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}
