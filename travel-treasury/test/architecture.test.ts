import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

/** Schema DDL with SQL comments stripped, so prose cannot trip these checks. */
function ddlOnly(): string {
  return readFileSync('src/server/db/schema.sql', 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .toLowerCase();
}

const coreFiles = walk('src/core');
const webFiles = walk('src/web');

/**
 * The layering is a guarantee, not a convention. These tests are what make the
 * claim in ARCHITECTURE.md true.
 */
describe('architecture boundaries', () => {
  it('has core files to check', () => {
    expect(coreFiles.length).toBeGreaterThan(5);
  });

  it('core never imports from the server or the web layer', () => {
    for (const f of coreFiles) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must not import the server layer`).not.toMatch(/from ['"].*\/server\//);
      expect(src, `${f} must not import the web layer`).not.toMatch(/from ['"].*\/web\//);
    }
  });

  it('core has no I/O and no framework dependencies', () => {
    for (const f of coreFiles) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must not import node:fs`).not.toMatch(/from ['"]node:fs['"]/);
      expect(src, `${f} must not import a database driver`).not.toMatch(/from ['"](pg|@electric-sql\/pglite)['"]/);
      expect(src, `${f} must not import fastify`).not.toMatch(/from ['"]fastify['"]/);
      expect(src, `${f} must not import react`).not.toMatch(/from ['"]react['"]/);
    }
  });

  it('the web layer never imports the database layer', () => {
    for (const f of webFiles) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must not import the db layer`).not.toMatch(/server\/db/);
      expect(src, `${f} must not import a database driver`).not.toMatch(/from ['"](pg|@electric-sql\/pglite)['"]/);
    }
  });

  it('no money formula lives outside core: the web layer never divides money or builds rates', () => {
    for (const f of webFiles) {
      const src = readFileSync(f, 'utf8');
      // Rates and costs are computed in core and arrive pre-computed.
      expect(src, `${f} must not construct rates`).not.toMatch(/\beffectiveRate\s*\(/);
      expect(src, `${f} must not compute percentages of money`).not.toMatch(/\bpercentOf\s*\(/);
      expect(src, `${f} must not call the withdrawal engine directly`).not.toMatch(/\bcomputeWithdrawal\s*\(/);
    }
  });

  it('no money value is ever handled as a JavaScript float in core', () => {
    for (const f of coreFiles) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must not use parseFloat on money`).not.toMatch(/parseFloat/);
      expect(src, `${f} must not use Math.round for money`).not.toMatch(/Math\.round/);
      expect(src, `${f} must not use toFixed`).not.toMatch(/toFixed/);
    }
  });

  it('the schema stores no card credential', () => {
    const schema = ddlOnly();
    for (const forbidden of ['pan ', 'full_pan', 'pin_', ' pin ', 'cvv', 'otp_', 'card_number', 'bank_password']) {
      expect(schema, `schema must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the schema uses no floating point column for money', () => {
    const schema = ddlOnly();
    expect(schema).not.toMatch(/\b(float|real|double precision)\b/);
  });
});
