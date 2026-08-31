const ACCESSED = '2026-08-31';
export const FINANCIAL_SOURCES = [
    {
        id: 'S1', institution: 'Central Bank of Iraq', title: 'Central Bank of Iraq — official site',
        url: 'https://cbi.iq', sourceClass: 'PRIMARY', accessedAt: ACCESSED, publishedAt: null,
        retrievalStatus: 'BLOCKED',
        notes: 'Direct retrieval blocked by network egress policy. No CBI SAR/IQD reference rate established.',
    },
    {
        id: 'S2', institution: 'NEO Iraq', title: 'NEO — Cards Features / Our Products / FAQs / Terms',
        url: 'https://neo.iq/en/our-products/cards-features', sourceClass: 'PRIMARY', accessedAt: ACCESSED,
        publishedAt: null, retrievalStatus: 'SNIPPET_ONLY',
        notes: 'Official page text seen through a search index only; no effective date visible.',
    },
    {
        id: 'S3', institution: 'National Bank of Iraq', title: 'NBI — List of Fees and Commissions',
        url: 'https://www.nbi.iq/-/media/files/fees-and-commsion-en.ashx', sourceClass: 'PRIMARY',
        accessedAt: ACCESSED, publishedAt: null, retrievalStatus: 'SNIPPET_ONLY',
        notes: 'Official tariff document; only indexed fragments readable. Scope of "outside the national network" unresolved.',
    },
    {
        id: 'S5', institution: 'Qi Card / Rafidain Bank', title: 'Qi Card — Cross Borders / Qi Mastercard from Rafidain Bank',
        url: 'https://qi.iq/en/cross-borders', sourceClass: 'PRIMARY', accessedAt: ACCESSED, publishedAt: null,
        retrievalStatus: 'SNIPPET_ONLY',
        notes: 'Marketing copy only. No international ATM fee, FX rate or limit published in anything retrievable.',
    },
    {
        id: 'S6', institution: 'Visa', title: 'Visa — What is Dynamic Currency Conversion? / Partial Authorization Service',
        url: 'https://usa.visa.com/travel-with-visa/dynamic-currency-conversion.html', sourceClass: 'PRIMARY',
        accessedAt: ACCESSED, publishedAt: null, retrievalStatus: 'SNIPPET_ONLY',
        notes: 'Scheme rules on DCC disclosure and cardholder choice.',
    },
    {
        id: 'S7', institution: 'Mastercard', title: 'Mastercard — Dynamic Currency Conversion Compliance Guide (2025)',
        url: 'https://www.mastercard.com/content/dam/mccom/shared/business/support/rules-pdfs/DCC-Guide-2025-Merchant-Version.pdf',
        sourceClass: 'PRIMARY', accessedAt: ACCESSED, publishedAt: '2025', retrievalStatus: 'SNIPPET_ONLY',
        notes: 'DCC disclosure requirements.',
    },
    {
        id: 'S8', institution: 'Saudi Central Bank (SAMA)', title: 'SAMA — official site',
        url: 'https://www.sama.gov.sa', sourceClass: 'PRIMARY', accessedAt: ACCESSED, publishedAt: null,
        retrievalStatus: 'BLOCKED',
        notes: 'Blocked. No SAMA tariff has been applied to any Iraqi-issued card — see FINANCIAL-RESEARCH.md record SA-04.',
    },
    {
        id: 'S9', institution: 'BBAC Bank Iraq', title: 'Updated Monthly Limits for Card Usage Abroad',
        url: 'https://bbacbank.com.iq/Service/104/186/Cards/Updated-Monthly-Limits-for-Card-Usage-Abroad',
        sourceClass: 'SECONDARY', accessedAt: ACCESSED, publishedAt: null, retrievalStatus: 'SNIPPET_ONLY',
        notes: 'An Iraqi bank restating CBI instructions on monthly card limits abroad.',
    },
    {
        id: 'S12', institution: 'The New Region', title: 'Iraq to suspend MasterCard use for foreign transactions',
        url: 'https://thenewregion.com/posts/2070', sourceClass: 'SECONDARY', accessedAt: ACCESSED,
        publishedAt: '2025-04', retrievalStatus: 'SNIPPET_ONLY',
        notes: 'Single-sourced. Highest operational risk finding: may prevent Mastercard products working abroad.',
    },
    {
        id: 'S16', institution: 'FX aggregators (Wise, exchangerates.org.uk)', title: 'IQD–SAR mid-market cross-rate',
        url: 'https://wise.com/gb/currency-converter/iqd-to-sar-rate/history', sourceClass: 'SECONDARY',
        accessedAt: ACCESSED, publishedAt: '2026-07-28', retrievalStatus: 'SNIPPET_ONLY',
        notes: 'Mid-market only — not obtainable by a consumer and not a settlement rate.',
    },
    {
        id: 'S17', institution: 'Travel/ATM guides', title: 'Saudi ATM fees, limits and DCC practice',
        url: 'https://atmfeesaver.com/cash-atms-in-saudi-arabia/', sourceClass: 'SECONDARY', accessedAt: ACCESSED,
        publishedAt: '2026', retrievalStatus: 'SNIPPET_ONLY',
        notes: 'Basis for the editable SAR 5,000 per-transaction planning default. Unverified.',
    },
    {
        id: 'MANUAL', institution: '(user)', title: 'Confirmed directly with the issuer',
        url: '', sourceClass: 'PRIMARY', accessedAt: ACCESSED, publishedAt: null, retrievalStatus: 'RETRIEVED',
        notes: 'Used for rules the traveller has confirmed with their bank. These may be VERIFIED.',
    },
];
export function sourceById(id) {
    return FINANCIAL_SOURCES.find((s) => s.id === id);
}
