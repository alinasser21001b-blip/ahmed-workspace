import { describe, expect, it } from 'vitest';
import { applyApprovedCandidates } from './apply';
import { extractKnowledge } from './extract';
import { emptySeededStore } from '../../data/store';
import type { ExtractionCandidate, KnowledgeDocument } from '../models';

describe('approved extraction becomes exam knowledge', () => {
  it('adds a new examiner question with source provenance', () => {
    const store = emptySeededStore();
    const document: KnowledgeDocument = {
      id: 'doc_new',
      filename: 'recall.md',
      fileType: 'markdown',
      uploadedAt: '2026-08-28T00:00:00.000Z',
      processingStatus: 'PROCESSED',
      department: 'pediatrics',
      sourceYear: 2026,
      version: 2,
    };
    const extracted = extractKnowledge(
      `Specialty: Pediatrics
Examiner: Dr. Ahmed
Year: 2026
Case: Nephrotic Syndrome

Q1: Why is fever an emergency in nephrotic syndrome?
Expected: Peritonitis and sepsis until proven otherwise.
`,
      {
        documentId: document.id,
        examiners: store.examiners,
        cases: store.cases,
      },
    );
    const approved: ExtractionCandidate[] = extracted.map((row) => ({ ...row, decision: 'APPROVED' }));
    const mutated = applyApprovedCandidates(approved, store, document);
    const added = mutated.questions.find((q) => q.questionText.toLowerCase().includes('fever'));
    expect(added).toBeTruthy();
    expect(added?.sample).toBe(false);
    expect(added?.sourceDocumentIds).toContain('doc_new');
    const occurrence = mutated.occurrences.find((row) => row.questionId === added?.id);
    expect(occurrence?.sourceDocumentId).toBe('doc_new');
    expect(occurrence?.sourceText.toLowerCase()).toContain('fever');
    const link = mutated.examinerQuestions.find(
      (eq) => eq.examinerId === 'ex_ahmed_peds' && eq.questionId === added?.id,
    );
    expect(link?.caseId).toBe('case_nephrotic');
  });
});
