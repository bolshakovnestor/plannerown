import { cors } from "./_shared/core.ts";
import assistant from "./r_assistant.ts";
import cron from "./r_cron.ts";
import gcal from "./r_gcal.ts";
import monoHook from "./r_mono_hook.ts";

// Один вхід: /functions/v1/api/<route>
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const route = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  try {
    if (route === "assistant") return await assistant(req);
    if (route === "cron") return await cron(req);
    if (route === "gcal") return await gcal(req);
    if (route === "mono-hook") return await monoHook(req);
    return new Response(JSON.stringify({ error: "unknown route " + route }), { status: 404, headers: { ...cors, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...cors, "content-type": "application/json" } });
  }
});
