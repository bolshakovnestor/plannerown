import { admin, cfg, applyMonoItem, loadState } from "./_shared/core.ts";

// Вебхук Monobank: GET — перевірка, POST — нова операція в реальному часі.
export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") return new Response("ok");
  const db = admin();
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== await cfg(db, "cron_secret")) return new Response("forbidden", { status: 403 });
  const uid = await cfg(db, "owner_uid");
  const body = await req.json().catch(() => null);
  if (!uid || body?.type !== "StatementItem") return new Response("ok");
  const { account, statementItem: it } = body.data;
  const st = await loadState(db, uid);
  await applyMonoItem(db, uid, account, it, st);
  const acc = st.accounts.find((a) => a.mono_account_id === account);
  if (acc && it.balance !== undefined) {
    const bal = Number(it.balance) / 100;
    await db.from("accounts").update({ balance: bal }).eq("id", acc.id);
    if (acc.kind === "credit_card" && acc.credit_limit) {
      await db.from("debts").update({ balance: Math.max(0, Number(acc.credit_limit) - bal) })
        .eq("user_id", uid).eq("kind", "credit_line").eq("lender", "monobank");
    }
  }
  return new Response("ok");
}
