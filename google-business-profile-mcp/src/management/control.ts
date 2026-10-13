import { DurableObject } from "cloudflare:workers";
import {
  type ConnectorEnv,
  googleRequest,
  refreshAccessToken,
  GoogleApiError,
} from "../google-client";
import { loadInternalGoogleRefreshToken } from "../stored-google-token";
import { API, endpoint, errorData, canonical, type Json } from "./api";
import { managementRead } from "./reads";

// Only an internal service binding can reach this object. There is no public route.
export class GBPControl extends DurableObject<ConnectorEnv> {
  async fetch(request: Request) {
    const a = await request.json<Json>();
    const store = this.ctx.storage;
    const action = new URL(request.url).pathname;
    if (action === "/preview") {
      const old = await store.list<Json>({ prefix: "preview:", limit: 200 });
      for (const [k, p] of old)
        if (p.expires < Date.now()) await store.delete(k);
      const id = crypto.randomUUID();
      await store.put("preview:" + id, { ...a, expires: Date.now() + 600000 });
      return Response.json({
        previewId: id,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
    }
    if (action === "/claim")
      return store.transaction(async (tx) => {
        const receipt = await tx.get<Json>("receipt:" + a.key);
        if (receipt) return Response.json({ replay: true, ...receipt });
        const p = await tx.get<Json>("preview:" + a.previewId);
        if (
          !p ||
          p.expires < Date.now() ||
          p.owner !== a.owner ||
          p.argsHash !== a.argsHash ||
          p.stateHash !== a.stateHash ||
          p.name !== a.name
        )
          return Response.json(
            {
              error:
                "Preview expired, changed, or belongs to another user. Prepare a new preview.",
            },
            { status: 409 },
          );
        if (p.used)
          return Response.json(
            {
              error:
                "Preview already consumed. Read the prior outcome before preparing a new action.",
            },
            { status: 409 },
          );
        await tx.put("preview:" + a.previewId, { ...p, used: true });
        await tx.put("receipt:" + a.key, {
          status: "pending",
          operation: a.name,
          createdAt: new Date().toISOString(),
        });
        return Response.json({ claimed: true });
      });
    if (action === "/finish") {
      await store.put("receipt:" + a.key, {
        status: a.status,
        result: a.result,
        operation: a.name,
        updatedAt: new Date().toISOString(),
      });
      await store.put("audit:" + Date.now() + ":" + crypto.randomUUID(), {
        operation: a.name,
        status: a.status,
        time: new Date().toISOString(),
        previewId: a.previewId,
      });
      return Response.json({ saved: true });
    }
    if (action === "/get")
      return Response.json((await store.get(a.key)) ?? null);
    if (action === "/list") {
      const map = await store.list({
        prefix: a.prefix,
        limit: a.limit || 100,
        reverse: true,
      });
      return Response.json({ items: [...map.values()] });
    }
    if (action === "/put" || action === "/delete") {
      const changed = await store.transaction(async tx => {
        const current=(await tx.get(a.key))??null;
        if(canonical(current)!==canonical(a.expected))return false;
        if(action==='/put')await tx.put(a.key,a.value);else await tx.delete(a.key);
        return true;
      });
      if(!changed)return Response.json({error:'Resource changed after preview. A running job cannot be cancelled.'},{status:409});
      if (a.key.startsWith("job:")) await this.arm();
      return Response.json(action==='/put'?{saved:true,value:await store.get(a.key)}:{deleted:true});
    }
    return new Response(null, { status: 404 });
  }
  async arm() {
    const jobs = await this.ctx.storage.list<Json>({ prefix: "job:" });
    const due = [...jobs.values()]
      .filter((j) => j.status === "scheduled")
      .map((j) => Date.parse(j.runAt));
    if (due.length)
      await this.ctx.storage.setAlarm(
        Math.max(Date.now() + 1000, Math.min(...due)),
      );
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    const jobs = await this.ctx.storage.list<Json>({ prefix: "job:" });
    for (const [key, job] of jobs) {
      if (job.status !== "scheduled" || Date.parse(job.runAt) > Date.now())
        continue;
      // Claim before any network write. An interrupted run is never blindly retried.
      const claimed=await this.ctx.storage.transaction(async tx=>{
        const current=await tx.get<Json>(key);
        if(!current||current.status!=='scheduled'||canonical(current)!==canonical(job))return false;
        await tx.put(key,{...job,status:'running',startedAt:new Date().toISOString()});
        return true;
      });
      if(!claimed)continue;
      try {
        const refresh = await loadInternalGoogleRefreshToken(this.env);
        if (!refresh)
          throw new GoogleApiError(
            "GBP authorization unavailable.",
            503,
            "not_configured",
          );
        const token = await refreshAccessToken(this.env, refresh);
        const request = (u: string, i?: RequestInit) =>
          googleRequest(token, u, i);
        let result: unknown;
        if (job.kind === "post") {
          await request(
            endpoint(API.info, job.location, { readMask: "name,metadata" }),
          ).then((p) => {
            if (p.metadata?.hasVoiceOfMerchant !== true)
              throw new GoogleApiError(
                "Voice of Merchant required for scheduled publication.",
                403,
                "permission_denied",
              );
          });
          const created = await request(
            endpoint(API.v4, job.account + "/" + job.location + "/localPosts"),
            { method: "POST", body: JSON.stringify(job.post) },
          );
          result = {
            accepted: created,
            readBack: created.name
              ? await request(endpoint(API.v4, created.name))
              : null,
            publicVisibility:
              "Google controls moderation; inspect returned post state.",
          };
        } else {
          const tool: Json = {
            weekly_report: "run_full_audit",
            monthly_report: "performance_summary",
            unanswered_reviews: "review_summary",
            media_followup: "check_media_publication",
            profile_changes: "get_google_updates",
          };
          result = await managementRead(request, tool[job.kind], {
            ...job,
            period: "monthly",
            unansweredOnly: true,
          });
          await this.ctx.storage.put("report:" + Date.now() + ":" + job.id, {
            jobId: job.id,
            kind: job.kind,
            createdAt: new Date().toISOString(),
            result,
          });
        }
        const recurring = [
          "weekly_report",
          "monthly_report",
          "unanswered_reviews",
          "profile_changes",
        ].includes(job.kind);
        const next = new Date(job.runAt);
        if (job.kind === "monthly_report")
          next.setUTCMonth(next.getUTCMonth() + 1);
        else next.setUTCDate(next.getUTCDate() + 7);
        // Missed runs do not send a backlog of reports or posts.
        while (recurring && next.getTime() <= Date.now()) {
          if (job.kind === "monthly_report")
            next.setUTCMonth(next.getUTCMonth() + 1);
          else next.setUTCDate(next.getUTCDate() + 7);
        }
        await this.ctx.storage.put(key, {
          ...job,
          status: recurring ? "scheduled" : "completed",
          runAt: recurring ? next.toISOString() : job.runAt,
          lastRunAt: new Date().toISOString(),
          lastResult: result,
        });
      } catch (e) {
        await this.ctx.storage.put(key, {
          ...job,
          status: "needs_review",
          error: errorData(e),
          note: "Execution was not automatically retried. Inspect current Google state before scheduling a replacement.",
        });
      }
    }
    await this.arm();
  }
}
export async function control(env: ConnectorEnv, path: string, body: Json) {
  if (!env.GBP_CONTROL)
    throw new GoogleApiError(
      "Secure approval storage is not configured.",
      503,
      "not_configured",
    );
  const stub = env.GBP_CONTROL.get(
    env.GBP_CONTROL.idFromName("white5-management-v1"),
  );
  const response = await stub.fetch("https://control.internal" + path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await response.json<any>();
  if (!response.ok)
    throw new GoogleApiError(
      data.error || "Approval state unavailable.",
      response.status,
      "approval_conflict",
    );
  return data;
}
