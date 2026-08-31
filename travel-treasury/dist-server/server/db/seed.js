import { FINANCIAL_SOURCES } from "../../core/research/sources.js";
import { SEED_FEE_RULES } from "../../core/research/seed-rules.js";
import { hashPassword } from "../auth.js";
import { newId } from "../util.js";
/**
 * Idempotent seed: the research evidence registry and the researched tariff
 * rules, exactly as documented, each pointing at its source. Nothing here is
 * marked VERIFIED, because nothing earned it — see docs/FINANCIAL-RESEARCH.md.
 */
export async function seedResearch(db) {
    await db.transaction(async (tx) => {
        for (const s of FINANCIAL_SOURCES) {
            await tx.query(`INSERT INTO financial_sources (id, institution, title, url, source_class, accessed_at, published_at, retrieval_status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET institution=$2, title=$3, url=$4, source_class=$5, accessed_at=$6, published_at=$7, retrieval_status=$8, notes=$9`, [s.id, s.institution, s.title, s.url, s.sourceClass, s.accessedAt, s.publishedAt, s.retrievalStatus, s.notes]);
        }
        for (const r of SEED_FEE_RULES) {
            await tx.query(`INSERT INTO fee_rules (id, card_id, issuer, product, rule_type, transaction_type, region,
                                amount_minor, amount_currency, percent, min_minor, max_minor, amount_is_range,
                                currency, effective_from, effective_to, source_id, confidence, is_ambiguous, ambiguity_note, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (id) DO NOTHING`, [
                r.id, r.cardId ?? null, r.issuer ?? null, r.product ?? null, r.ruleType, r.transactionType, r.region,
                r.amount?.minor.toString() ?? null, r.amount?.currency ?? null, r.percent ?? null,
                r.min?.minor.toString() ?? null, r.max?.minor.toString() ?? null, r.amountIsRange ?? false,
                r.currency, r.effectiveFrom, r.effectiveTo ?? null, r.sourceId, r.confidence,
                r.isAmbiguous ?? false, r.ambiguityNote ?? null, r.notes ?? null,
            ]);
        }
    });
}
export async function seedUsers(db, users) {
    for (const u of users) {
        const existing = await db.query(`SELECT id FROM users WHERE email = $1`, [u.email.toLowerCase()]);
        if (existing.rows[0])
            continue;
        const hash = await hashPassword(u.password);
        await db.query(`INSERT INTO users (id, email, password_hash, role, display_name, locale) VALUES ($1,$2,$3,$4,$5,'ar')`, [newId('user'), u.email.toLowerCase(), hash, u.role, u.displayName]);
    }
}
