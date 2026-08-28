import { describe, expect, it } from 'vitest';
import { extractKnowledge } from './extract';
import { findCanonicalQuestion } from './dedupe';
import { scoreExtraction } from './confidence';
import { parseDocument } from './parse';
import type { Question } from '../models';

const ctx = {
  documentId: 'doc_test',
  examiners: [
    {
      id: 'ex_ahmed_peds',
      name: 'Dr. Ahmed (Sample)',
      aliases: ['Dr. Ahmed'],
      departmentId: 'pediatrics' as const,
    },
  ],
  cases: [{ id: 'case_nephrotic', title: 'Nephrotic Syndrome', departmentId: 'pediatrics' as const }],
};

const SAMPLE_NOTE = `
Specialty: Pediatrics
Examiner: Dr. Ahmed
Year: 2025
Case: Nephrotic Syndrome

Q1: What is the most likely diagnosis?
Expected: Nephrotic syndrome

Q2: What are the complications of nephrotic syndrome?
Expected: Infection, thrombosis, hypovolemia
`;

describe('knowledge extraction', () => {
  it('extracts examiner, case, questions and answers from a structured recall note', () => {
    const candidates = extractKnowledge(SAMPLE_NOTE, ctx);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]?.specialtyId).toBe('pediatrics');
    expect(candidates[0]?.examinerId).toBe('ex_ahmed_peds');
    expect(candidates[0]?.caseId).toBe('case_nephrotic');
    expect(candidates[0]?.questionText?.toLowerCase()).toMatch(/diagnosis/);
    expect(candidates[0]?.expectedAnswer?.toLowerCase()).toMatch(/nephrotic/);
    expect(candidates.every((c) => c.sourceText.length > 0)).toBe(true);
  });

  it('flags unstructured text for review rather than silently accepting it', () => {
    const candidates = extractKnowledge('random notes without structure', ctx);
    expect(candidates[0]?.reviewRequired).toBe(true);
    expect(candidates[0]?.band).not.toBe('HIGH');
  });

  it('does not treat medium confidence as auto-accept', () => {
    const scored = scoreExtraction({
      hasSpecialty: true,
      hasExaminer: true,
      hasCase: false,
      hasQuestion: true,
      hasAnswer: false,
      structuredMarkers: 0,
    });
    expect(scored.reviewRequired).toBe(true);
  });
});

describe('deduplication', () => {
  it('links phrasing variants to a canonical question without destroying wording', () => {
    const existing: Question[] = [
      {
        id: 'q_ns_04',
        caseId: 'case_nephrotic',
        questionText: 'What are the major complications of nephrotic syndrome?',
        expectedAnswer: 'Infection, thrombosis, hypovolemia',
        category: 'Complications',
        difficulty: 'standard',
        sourceDocumentIds: [],
        sample: true,
        canonicalQuestion: 'What are the major complications of nephrotic syndrome?',
        observedVariants: ['Complications?'],
      },
    ];
    const hit = findCanonicalQuestion('What are the complications of NS?', existing, 'case_nephrotic');
    expect(hit.isDuplicate).toBe(true);
    expect(hit.canonicalId).toBe('q_ns_04');
  });
});

describe('document parsing', () => {
  it('reads markdown and plaintext', async () => {
    const parsed = await parseDocument(Buffer.from(SAMPLE_NOTE, 'utf8'), 'recall.md');
    expect(parsed.fileType).toBe('markdown');
    expect(parsed.text).toContain('Dr. Ahmed');
  });
});
