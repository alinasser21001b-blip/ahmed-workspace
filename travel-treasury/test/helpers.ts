import { majorUnits, fromDecimalString, type Money } from '../src/core/money.ts';
import type { CardRef, WithdrawalInput, BalanceObservation } from '../src/core/withdrawal.ts';
import type { CurrencyCode } from '../src/core/currency.ts';

export const iqd = (n: number): Money => majorUnits(n, 'IQD');
export const sar = (n: number): Money => majorUnits(n, 'SAR');
export const usd = (n: number): Money => majorUnits(n, 'USD');
export const dec = (s: string, c: CurrencyCode): Money => fromDecimalString(s, c);

export function card(over: Partial<CardRef> = {}): CardRef {
  return {
    id: 'card_neo964',
    nickname: 'NEO 964',
    issuer: 'NEO Iraq',
    product: 'NEO 964',
    network: 'VISA',
    cardType: 'PREPAID',
    last4: '4821',
    ownership: 'PERSONAL',
    nativeCurrency: 'IQD',
    internationalStatus: 'CLAIMED_BY_ISSUER',
    ...over,
  };
}

export function balance(
  amount: Money,
  over: Partial<BalanceObservation> = {},
): BalanceObservation {
  return {
    amount,
    capturedAt: '2026-09-02T09:00:00Z',
    source: 'BANK_APP',
    balanceType: 'AVAILABLE',
    ...over,
  };
}

export function withdrawal(over: Partial<WithdrawalInput> = {}): WithdrawalInput {
  return {
    id: 'w1',
    card: card(),
    state: 'CAPTURED',
    transactionAt: '2026-09-02T09:05:00Z',
    dispensedSar: sar(1000),
    dcc: { offered: 'YES', selection: 'LOCAL_CURRENCY' },
    ...over,
  };
}
