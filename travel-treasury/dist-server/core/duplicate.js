import { equals } from "./money.js";
const WINDOW_MINUTES = 30;
function minutesBetween(a, b) {
    const ms = new Date(a).getTime() - new Date(b).getTime();
    const abs = ms < 0 ? -ms : ms;
    // Whole minutes via integer arithmetic; this file stays float-free like the
    // rest of core even though time, unlike money, would tolerate a float.
    return (abs - (abs % 60000)) / 60000;
}
/**
 * Warn about a probable duplicate before it is written.
 *
 * This warns; it does not block. Two genuine withdrawals of the same amount
 * from the same machine minutes apart are entirely possible when an ATM caps
 * each withdrawal, and refusing them would be worse than a duplicate the user
 * can see and dismiss. Blocking is the job of the idempotency key, which
 * catches the case this cannot: the same submission arriving twice.
 */
export function findDuplicates(candidate, existing) {
    const findings = [];
    for (const e of existing) {
        if (e.cardId !== candidate.cardId)
            continue;
        const reasons = [];
        let risk = 'NONE';
        if (candidate.transactionReference &&
            e.transactionReference &&
            candidate.transactionReference === e.transactionReference) {
            reasons.push('Identical transaction reference.');
            findings.push({ existingId: e.id, risk: 'CERTAIN', reasons, minutesApart: minutesBetween(candidate.transactionAt, e.transactionAt) });
            continue;
        }
        const mins = minutesBetween(candidate.transactionAt, e.transactionAt);
        if (mins > WINDOW_MINUTES)
            continue;
        const sameAmount = e.dispensedSar.currency === candidate.dispensedSar.currency &&
            equals(e.dispensedSar, candidate.dispensedSar);
        if (!sameAmount)
            continue;
        reasons.push(`Same card and same amount within ${mins} minute(s).`);
        risk = 'MEDIUM';
        if (candidate.atmTerminalId && e.atmTerminalId && candidate.atmTerminalId === e.atmTerminalId) {
            reasons.push('Same ATM terminal ID.');
            risk = 'HIGH';
        }
        else if (candidate.atmOperator && e.atmOperator && candidate.atmOperator === e.atmOperator) {
            reasons.push('Same ATM operator.');
            risk = 'HIGH';
        }
        if (mins <= 3) {
            reasons.push('Recorded within three minutes of the existing entry.');
            risk = 'HIGH';
        }
        findings.push({ existingId: e.id, risk, reasons, minutesApart: mins });
    }
    const order = { CERTAIN: 0, HIGH: 1, MEDIUM: 2, NONE: 3 };
    return findings.sort((a, b) => order[a.risk] - order[b.risk]);
}
export function highestRisk(findings) {
    if (findings.length === 0)
        return 'NONE';
    return findings[0]?.risk ?? 'NONE';
}
