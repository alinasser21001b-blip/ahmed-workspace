import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { hashPassword, verifyPassword } from "./lib/crypto";

const instances = new Map<string, ReturnType<typeof build>>();

function build(env: Env, origin: string) {
  const iterations = Number(env.PBKDF2_ITERATIONS) || 100_000;
  return betterAuth({
    appName: "متابعة الوكالة",
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      password: {
        hash: (password) => hashPassword(password, iterations),
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 32 })],
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        // Backstop only: the four phones share one office address, so the
        // real limit is per address and username in worker/index.ts.
        "/sign-in/username": { window: 900, max: 40 },
      },
    },
    advanced: {
      useSecureCookies: origin.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof build>;

/** One Better Auth instance per origin per isolate; the origin comes from the request URL, never from a header the client chooses. */
export function getAuth(env: Env, origin: string): Auth {
  let a = instances.get(origin);
  if (!a) {
    a = build(env, origin);
    instances.set(origin, a);
  }
  return a;
}
