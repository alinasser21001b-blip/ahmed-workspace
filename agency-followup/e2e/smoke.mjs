// Unauthenticated checks against a deployed URL. Needs no credentials.
//   BASE_URL=https://agency-followup.<sub>.workers.dev node e2e/smoke.mjs
const BASE = process.env.BASE_URL.replace(/\/$/, "");
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const get = (p, init) => fetch(BASE + p, { redirect: "manual", ...init });
const post = (p, body, headers = {}) => get(p, { method: "POST", headers: { "content-type": "application/json", origin: BASE, ...headers }, body: JSON.stringify(body) });
async function json(res) {
  try {
    return { ct: res.headers.get("content-type") ?? "", body: await res.json() };
  } catch {
    return { ct: res.headers.get("content-type") ?? "", body: null };
  }
}

let r = await get("/");
const html = await r.text();
check("home page serves the app", r.status === 200 && html.includes('lang="ar"') && html.includes('dir="rtl"'), `status ${r.status}`);
check("security headers present", !!r.headers.get("content-security-policy") && r.headers.get("x-frame-options") === "DENY");
r = await get("/tasks/t_deep_link_check");
check("deep link returns the app (SPA fallback)", r.status === 200 && (await r.text()).includes('id="root"'), `status ${r.status}`);
r = await get("/api/health");
check("health endpoint", r.status === 200 && (await json(r)).body?.ok === true);
r = await get("/api/does-not-exist");
let j = await json(r);
check("unknown /api route returns JSON, not HTML", j.ct.includes("application/json") && j.body?.error, `status ${r.status}`);
check("API responses are not cached", r.headers.get("cache-control") === "no-store");
r = await get("/api/today");
check("protected route without a session → 401 JSON", r.status === 401 && (await json(r)).body?.error === "unauthenticated");
r = await post("/api/auth/sign-in/username", { username: "smoke-check-nobody", password: "wrong-password-123" });
j = await json(r);
check("wrong credentials → generic 401", r.status === 401 && j.body?.error === "invalid_credentials", `status ${r.status}`);
r = await post("/api/auth/sign-up/email", { email: "x@example.com", password: "whatever-123456", name: "x" });
check("public sign-up is closed", r.status === 404, `status ${r.status}`);
r = await post("/api/auth/sign-in/username", { username: "a", password: "b" }, { origin: "https://evil.example" });
check("foreign Origin is refused", r.status === 403, `status ${r.status}`);
r = await post("/api/setup/check", { token: "not-a-real-token-xxxxxxxxxxxxxxxxxxxxxxxxxx" });
check("setup check rejects unknown tokens", r.status === 200 && (await json(r)).body?.valid === false);
r = await get("/sw.js");
check("service worker served", r.status === 200 && (await r.text()).includes("notificationclick"));
r = await get("/manifest.webmanifest");
check("manifest served", r.status === 200);
r = await get("/icons/apple-touch-icon.png");
check("home-screen icon served", r.status === 200);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} smoke checks passed`);
process.exit(failed ? 1 : 0);
