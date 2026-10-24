import { describe, expect, it } from "vitest";
import { act, Browser, createTask, signIn, task } from "./helpers";

describe("smoke", () => {
  it("signs in, creates, acknowledges, submits and approves", async () => {
    const sama = await signIn("sama");
    const hussein = await signIn("hussein");
    const me = await sama.get("/api/account/me");
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("account_manager");
    const id = await createTask(sama, { client_id: "c_obesity", assignee_id: "u_hussein", due_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await act(hussein, id, "ack")).status).toBe(200);
    expect((await act(hussein, id, "start")).status).toBe(200);
    expect((await act(hussein, id, "submit", { evidence: "صور في المجلد" })).status).toBe(200);
    const r = await act(sama, id, "approve");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await task(sama, id)).task.status).toBe("done");
  });

  it("returns JSON for unknown api routes", async () => {
    const b = new Browser();
    const r = await b.get("/api/nope");
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("unauthenticated");
  });
});
