import type { SpecialtyId } from './domain';

const aliases: Record<SpecialtyId, string[]> = {
  INTERNAL_MEDICINE: ['internal medicine', 'medicine', 'internal', 'باطنية'],
  PEDIATRICS: ['pediatrics', 'pediatric', 'paediatrics', 'children', 'أطفال', 'اطفال'],
  SURGERY: ['surgery', 'surgical', 'جراحة'],
  MINOR_SPECIALTIES: ['minor specialties', 'minors', 'ماينورات'],
  OBSTETRICS_GYNECOLOGY: ['obgyn', 'ob/gyn', 'obstetrics', 'gynecology', 'gynaecology', 'gyne', 'نسائية'],
};
export function normalizeText(value: string) { return value.normalize('NFKC').replace(/[،؛]/g, ' ').replace(/\s+/g, ' ').trim(); }
export function normalizeName(value: string) { return normalizeText(value).replace(/^(dr\.?|د\.?|دكتور)\s*/i, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').toLocaleLowerCase(); }
export function normalizeQuestion(value: string) { return normalizeText(value).toLocaleLowerCase().replace(/\bns\b/g, 'nephrotic syndrome').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim(); }
export function resolveSpecialty(value: string): SpecialtyId | undefined { const normalized = normalizeText(value).toLocaleLowerCase(); return (Object.entries(aliases) as [SpecialtyId, string[]][]).find(([, values]) => values.some((alias) => normalized.includes(alias)))?.[0]; }
export function confidenceBand(confidence: number) { return confidence >= .9 ? 'HIGH' : confidence >= .7 ? 'MEDIUM' : 'LOW'; }
