# ADR-0005 — scrypt from Node's standard library

**Status:** Accepted · Phase 0

## Context

Passwords need a memory-hard KDF. argon2id is the modern first choice, but
every Node binding is a native module — a build step that can fail in CI or on
a deploy host. The Constitution forbids bespoke cryptography (§15) but says
nothing about which standard primitive.

## Decision

`crypto.scrypt` at N=2^16, r=8, p=1, 32-byte key, 16-byte salt — OWASP's
recommended parameters for scrypt. Hashes are **version-prefixed**:

```
scrypt$65536$8$1$<salt-b64>$<hash-b64>
```

`needsRehash()` runs on every successful login and transparently upgrades
outdated parameters.

## Consequences

**Good.** No native build, so CI and deploys cannot break on a compiler.
scrypt is a standard, well-analysed, memory-hard KDF — not a custom scheme. The
versioned format means moving to argon2id later is a rehash-on-next-login
migration, not a forced password reset for every user.

**Bad.** argon2id has better resistance to some GPU/ASIC attacks.

**Accepted** because the versioned format makes the upgrade cheap, and because
a hash function that cannot be deployed protects nothing.

Verification is constant-time (`timingSafeEqual`), and login runs a real
verification against a dummy hash when the account does not exist, so response
timing cannot distinguish "no such account" from "wrong password".
