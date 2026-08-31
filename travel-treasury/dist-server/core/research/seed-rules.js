import { majorUnits } from "../money.js";
/**
 * Tariff rules as researched on 2026-08-31.
 *
 * Every rule carries the confidence its evidence actually supports. Not one
 * reaches VERIFIED, because outbound HTTP was blocked during research and no
 * primary tariff document could be opened — see FINANCIAL-RESEARCH.md §1.
 *
 * These are seeds, not truths. They produce ESTIMATED figures only, they are
 * fully editable in the app, and nothing they generate can be presented as a
 * verified cost.
 */
export const SEED_FEE_RULES = [
    // ---------------------------------------------------------------- NEO ----
    {
        id: 'seed_neo_fx_cemea',
        issuer: 'NEO Iraq',
        product: null, // applies across NEO products per the published features page
        ruleType: 'FX_FEE',
        transactionType: 'ATM_WITHDRAWAL',
        region: 'CEMEA',
        percent: '2',
        currency: 'IQD',
        effectiveFrom: '2026-01-01',
        sourceId: 'S2',
        confidence: 'LIKELY',
        isAmbiguous: false,
        notes: 'Research record NEO-01. Saudi Arabia is inside Visa CEMEA, so this 2% tier is the one that ' +
            'applies to this trip rather than the 2.5% non-CEMEA tier. Effective date not established.',
    },
    {
        id: 'seed_neo_fx_non_cemea',
        issuer: 'NEO Iraq',
        product: null,
        ruleType: 'FX_FEE',
        transactionType: 'ATM_WITHDRAWAL',
        region: 'NON_CEMEA',
        percent: '2.5',
        currency: 'IQD',
        effectiveFrom: '2026-01-01',
        sourceId: 'S2',
        confidence: 'LIKELY',
        isAmbiguous: false,
        notes: 'Research record NEO-01, non-CEMEA tier. Not applicable to Saudi Arabia.',
    },
    {
        id: 'seed_neo964_atm_intl',
        issuer: 'NEO Iraq',
        product: 'NEO 964',
        ruleType: 'ATM_WITHDRAWAL_FEE',
        transactionType: 'ATM_WITHDRAWAL',
        region: 'CEMEA',
        amountIsRange: true,
        min: majorUnits(3000, 'IQD'),
        max: majorUnits(4000, 'IQD'),
        currency: 'IQD',
        effectiveFrom: '2026-01-01',
        sourceId: 'S2',
        confidence: 'LIKELY',
        isAmbiguous: true,
        ambiguityNote: 'Published as a 3,000–4,000 IQD range with no stated trigger for either end. The engine carries ' +
            'the range through rather than choosing a midpoint.',
        notes: 'Research record NEO-02. Stated for the 964 dinar card ONLY — do not apply to NEO USD products.',
    },
    // ---------------------------------------------------------------- NBI ----
    {
        id: 'seed_nbi_atm_outside_network',
        issuer: 'National Bank of Iraq',
        product: null,
        ruleType: 'ATM_WITHDRAWAL_FEE',
        transactionType: 'ATM_WITHDRAWAL',
        region: 'ANY',
        amount: majorUnits(10000, 'IQD'),
        currency: 'IQD',
        effectiveFrom: '2026-01-01',
        sourceId: 'S3',
        confidence: 'LIKELY',
        isAmbiguous: true,
        ambiguityNote: 'The tariff says "ATMs outside the national network". That may mean other Iraqi banks\' ATMs ' +
            'rather than foreign ATMs — different products at different prices. Confirm before relying on it ' +
            'for a Saudi withdrawal.',
        notes: 'Research record NBI-01.',
    },
    {
        id: 'seed_nbi_foreign_txn',
        issuer: 'National Bank of Iraq',
        product: null,
        ruleType: 'INTERNATIONAL_FEE',
        transactionType: 'ATM_WITHDRAWAL',
        region: 'ANY',
        currency: 'IQD',
        effectiveFrom: '2026-01-01',
        sourceId: 'S3',
        confidence: 'UNKNOWN',
        isAmbiguous: false,
        notes: 'Research record NBI-05. The foreign transaction commission was NOT found. It is unknown, not zero, ' +
            'and this rule exists precisely so the gap is visible rather than silently absent.',
    },
    // ------------------------------------------------------- Rafidain / Qi ----
    {
        id: 'seed_qi_atm_intl',
        issuer: 'Rafidain Bank / Qi Card',
        product: null,
        ruleType: 'ATM_WITHDRAWAL_FEE',
        transactionType: 'ATM_WITHDRAWAL',
        region: 'ANY',
        currency: 'IQD',
        effectiveFrom: '2026-01-01',
        sourceId: 'S5',
        confidence: 'UNKNOWN',
        isAmbiguous: false,
        notes: 'Research record QI-06. No international ATM fee is published for any Rafidain/Qi product. ' +
            'The domestic 0.3% fee must NOT be reused here.',
    },
    {
        id: 'seed_qi_fx',
        issuer: 'Rafidain Bank / Qi Card',
        product: null,
        ruleType: 'FX_FEE',
        transactionType: 'ATM_WITHDRAWAL',
        region: 'ANY',
        currency: 'IQD',
        effectiveFrom: '2026-01-01',
        sourceId: 'S5',
        confidence: 'UNKNOWN',
        isAmbiguous: false,
        notes: 'Research record QI-03. Qi markets a "guaranteed exchange rate" but publishes no rate and no margin, ' +
            'and the claim refers to purchases rather than ATM cash. The real rate becomes knowable only from ' +
            'the first settled withdrawal.',
    },
];
/**
 * Rules that exist to record an absence. Presenting these as fees would be
 * wrong; hiding them would be worse, because their absence is the finding.
 */
export const UNKNOWN_RULE_IDS = SEED_FEE_RULES.filter((r) => r.confidence === 'UNKNOWN').map((r) => r.id);
