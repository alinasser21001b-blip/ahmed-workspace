import {
  isSpecialtyId,
  type ExtractionCandidate,
  type QuestionCategory,
  type SpecialtyId,
  QUESTION_CATEGORIES,
} from '../models';
import { createId } from '../../lib/ids';
import { normalizeArabic, normalizeForMatch } from '../text/arabic';
import { scoreExtraction } from './confidence';

export interface ExtractionContext {
  documentId: string;
  examiners: readonly { id: string; name: string; aliases: string[]; departmentId: SpecialtyId }[];
  cases: readonly { id: string; title: string; departmentId: SpecialtyId }[];
}

const SPECIALTY_ALIASES: Record<string, SpecialtyId> = {
  pediatrics: 'pediatrics',
  paediatric: 'pediatrics',
  ped: 'pediatrics',
  اطفال: 'pediatrics',
  الأطفال: 'pediatrics',
  'internal medicine': 'internal-medicine',
  medicine: 'internal-medicine',
  باطنية: 'internal-medicine',
  الباطنية: 'internal-medicine',
  surgery: 'surgery',
  جراحة: 'surgery',
  الجراحة: 'surgery',
  minors: 'minor-specialties',
  'minor specialties': 'minor-specialties',
  ماينورات: 'minor-specialties',
  'obstetrics & gynecology': 'obstetrics-gynecology',
  'obstetrics and gynecology': 'obstetrics-gynecology',
  obgyn: 'obstetrics-gynecology',
  'ob/gyn': 'obstetrics-gynecology',
  نسائية: 'obstetrics-gynecology',
  النسائية: 'obstetrics-gynecology',
};

function detectSpecialty(text: string): SpecialtyId | undefined {
  const lines = text.split('\n').slice(0, 40).join('\n');
  const labeled = /(?:specialty|department|الاختصاص|القسم)\s*[:：]\s*(.+)/i.exec(lines);
  const raw = labeled?.[1]?.trim() ?? '';
  const blob = `${raw}\n${text.slice(0, 800)}`;
  const normalized = normalizeForMatch(blob);
  for (const [alias, id] of Object.entries(SPECIALTY_ALIASES)) {
    if (normalized.includes(normalizeForMatch(alias))) return id;
  }
  if (isSpecialtyId(raw)) return raw;
  return undefined;
}

function detectYear(text: string): number | undefined {
  const match = /(?:year|سنة)\s*[:：]?\s*((?:20)\d{2})/i.exec(text) ?? /\b(20\d{2})\b/.exec(text);
  if (!match?.[1]) return undefined;
  const year = Number(match[1]);
  return year >= 2000 && year <= 2100 ? year : undefined;
}

function matchExaminer(
  text: string,
  examiners: ExtractionContext['examiners'],
): { name: string; id?: string } | undefined {
  const labeled = /(?:examiner|doctor|dr\.?|الفاحص|د\.?)\s*[:：]?\s*([^\n]+)/i.exec(text);
  const fragment = labeled?.[1]?.trim();
  if (fragment) {
    const n = normalizeForMatch(fragment);
    const found = examiners.find(
      (examiner) =>
        normalizeForMatch(examiner.name).includes(n) ||
        n.includes(normalizeForMatch(examiner.name)) ||
        examiner.aliases.some((alias) => n.includes(normalizeForMatch(alias))),
    );
    return { name: fragment.replace(/\s+/g, ' '), id: found?.id };
  }

  for (const examiner of examiners) {
    const names = [examiner.name, ...examiner.aliases];
    if (names.some((name) => normalizeArabic(text).includes(normalizeArabic(name)))) {
      return { name: examiner.name, id: examiner.id };
    }
  }
  return undefined;
}

function matchCase(
  text: string,
  cases: ExtractionContext['cases'],
): { title: string; id?: string } | undefined {
  const labeled = /(?:case|الحالة)\s*[:：]\s*([^\n]+)/i.exec(text);
  if (labeled?.[1]) {
    const title = labeled[1].trim();
    const found = cases.find(
      (row) =>
        normalizeForMatch(row.title) === normalizeForMatch(title) ||
        normalizeForMatch(title).includes(normalizeForMatch(row.title)) ||
        normalizeForMatch(row.title).includes(normalizeForMatch(title)),
    );
    return { title, id: found?.id };
  }
  for (const row of cases) {
    if (normalizeArabic(text).includes(normalizeArabic(row.title))) {
      return { title: row.title, id: row.id };
    }
  }
  return undefined;
}

function detectCategory(question: string, answer: string): QuestionCategory | undefined {
  const blob = `${question} ${answer}`.toLowerCase();
  const rules: Array<[RegExp, QuestionCategory]> = [
    [/complicat|مضاعف/, 'Complications'],
    [/differenti|تفريق/, 'Differential Diagnosis'],
    [/investigat|lab|x-?ray|investig|تحر/, 'Investigation'],
    [/manag|treat|علاج|تدبير/, 'Management'],
    [/histor|تاريخ/, 'History'],
    [/examin|علام/, 'Examination'],
    [/diagnos|تشخيص/, 'Diagnosis'],
    [/emergenc|urgent|إسعاف/, 'Emergency'],
    [/drug|steroid|penicillin|insulin|دوا/, 'Pharmacology'],
    [/follow|counsel|نصح/, 'Follow-up'],
    [/interpret|ecg|abg/, 'Interpretation'],
  ];
  for (const [pattern, category] of rules) {
    if (pattern.test(blob)) return category;
  }
  if (QUESTION_CATEGORIES.includes(question as QuestionCategory)) return question as QuestionCategory;
  return undefined;
}

interface Block {
  question: string;
  answer: string;
  sourceText: string;
}

function extractBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const qaRegex =
    /(?:^|\n)\s*(?:q\s*\d*\s*[:.)-]|question\s*\d*\s*[:.)-]|س\s*\d*\s*[:.)-])\s*(.+?)(?:\n\s*(?:a|answer|expected|الجواب|الإجابة)\s*[:.)-]\s*([\s\S]+?))(?=(?:\n\s*(?:q\s*\d*\s*[:.)-]|question\s*\d*\s*[:.)-]|س\s*\d*\s*[:.)-])|\n##\s|\n#\s|$))/gi;

  let match: RegExpExecArray | null;
  while ((match = qaRegex.exec(text))) {
    const question = (match[1] ?? '').trim();
    const answer = (match[2] ?? '').trim().split(/\n{2,}/)[0]?.trim() ?? '';
    if (question) {
      blocks.push({ question, answer, sourceText: match[0].trim() });
    }
  }

  if (blocks.length === 0) {
    const looser = /(?:^|\n)\s*[-*]\s*(.+\?)\s*\n+([^]+?)(?=\n\s*[-*]\s*.+\?|$)/gi;
    while ((match = looser.exec(text))) {
      const question = (match[1] ?? '').trim();
      const answer = (match[2] ?? '').trim();
      if (question) blocks.push({ question, answer, sourceText: match[0].trim() });
    }
  }

  return blocks;
}

export function extractKnowledge(text: string, ctx: ExtractionContext): ExtractionCandidate[] {
  const specialtyId = detectSpecialty(text);
  const examiner = matchExaminer(text, ctx.examiners);
  const clinicalCase = matchCase(text, ctx.cases);
  const year = detectYear(text);
  const structuredMarkers =
    (/(?:specialty|examiner|case|question|expected)/i.test(text) ? 2 : 0) +
    (/(?:Q\s*\d+|Question\s*\d+)/i.test(text) ? 2 : 0);

  const blocks = extractBlocks(text);
  if (blocks.length === 0) {
    const scored = scoreExtraction({
      hasSpecialty: Boolean(specialtyId),
      hasExaminer: Boolean(examiner),
      hasCase: Boolean(clinicalCase),
      hasQuestion: false,
      hasAnswer: false,
      structuredMarkers,
    });
    return [
      {
        id: createId('ext'),
        documentId: ctx.documentId,
        specialtyId,
        examinerName: examiner?.name,
        examinerId: examiner?.id,
        caseTitle: clinicalCase?.title,
        caseId: clinicalCase?.id,
        sourceText: text.slice(0, 1200),
        year,
        confidence: scored.confidence,
        band: scored.band,
        decision: 'PENDING',
        reviewRequired: true,
      },
    ];
  }

  return blocks.map((block) => {
    const scored = scoreExtraction({
      hasSpecialty: Boolean(specialtyId),
      hasExaminer: Boolean(examiner),
      hasCase: Boolean(clinicalCase),
      hasQuestion: Boolean(block.question),
      hasAnswer: Boolean(block.answer),
      structuredMarkers,
    });
    const category = detectCategory(block.question, block.answer);
    return {
      id: createId('ext'),
      documentId: ctx.documentId,
      specialtyId,
      examinerName: examiner?.name,
      examinerId: examiner?.id,
      caseTitle: clinicalCase?.title,
      caseId: clinicalCase?.id,
      questionText: block.question,
      expectedAnswer: block.answer,
      category,
      year,
      sourceText: block.sourceText.slice(0, 2000),
      confidence: scored.confidence,
      band: scored.band,
      decision: 'PENDING',
      reviewRequired: scored.reviewRequired,
    };
  });
}
