import './_node-polyfills';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DeterministicExtractionProvider, extractText } from '../lib/knowledge/extractor';
import { confidenceBand, normalizeName, normalizeQuestion, resolveSpecialty } from '../lib/knowledge/normalization';
import { DeterministicAnswerEvaluationProvider } from '../lib/evaluation';

test('maps Arabic and English specialty aliases only to canonical categories', () => {
  assert.equal(resolveSpecialty('Pediatrics — أطفال'), 'PEDIATRICS');
  assert.equal(resolveSpecialty('باطنية'), 'INTERNAL_MEDICINE');
  assert.equal(resolveSpecialty('unknown subject'), undefined);
});
test('keeps Arabic doctor spelling restrained and strips titles', () => {
  assert.equal(normalizeName('د. أحمد علي'), 'احمد علي');
  assert.equal(normalizeName('Dr. Ahmed Ali'), 'ahmed ali');
});
test('normalizes safe question variants without losing the observed wording', () => {
  assert.equal(normalizeQuestion('Complications of NS?'), 'complications of nephrotic syndrome');
});
test('extracts the acceptance document without cross-linking examiner cases', async () => {
  const result = await new DeterministicExtractionProvider().extract({ filename: 'peds-2025.txt', text: `Pediatrics — 2025\nDr. Ahmed\nCase: Nephrotic Syndrome\nQuestions:\n- What is nephrotic syndrome?\n- What are the complications?\nDr. Hassan\nCase: Bronchiolitis\nQuestions:\n- How do you assess severity?\n- When do you admit the patient?` });
  assert.equal(result.specialtyId, 'PEDIATRICS');
  const questions = result.candidates.filter((candidate) => candidate.kind === 'QUESTION');
  assert.equal(questions.length, 4); assert.equal(questions[0].examiner, 'Dr. Ahmed'); assert.equal(questions[0].caseTitle, 'Nephrotic Syndrome'); assert.equal(questions[2].examiner, 'Dr. Hassan'); assert.equal(questions[2].caseTitle, 'Bronchiolitis');
});
test('uses centralized confidence bands for publication review decisions', () => { assert.equal(confidenceBand(.91), 'HIGH'); assert.equal(confidenceBand(.70), 'MEDIUM'); assert.equal(confidenceBand(.69), 'LOW'); });
test('grounds evaluation only in approved key points', async () => { const result=await new DeterministicAnswerEvaluationProvider().evaluate({question:'Complications?',referenceAnswer:'infection, thrombosis, hypovolemia',keyPoints:['infection','thrombosis','hypovolemia'],studentAnswer:'Infection and thrombosis.'});assert.equal(result.correctness,'PARTIAL');assert.deepEqual(result.missingPoints,['hypovolemia']); });
test('extracts DOCX paragraphs without collapsing candidate boundaries', async () => { const data = await readFile('test/fixtures/pediatrics-2026.docx'); const text = await extractText(new File([data], 'pediatrics-2026.docx')); const result = await new DeterministicExtractionProvider().extract({ filename:'pediatrics-2026.docx', text }); assert.equal(result.candidates.length, 4); });
test('extracts text PDF pages with provenance and rejects scanned PDFs for OCR', async () => { const textData = await readFile('test/fixtures/pediatrics-text.pdf'); const text = await extractText(new File([textData], 'pediatrics-text.pdf')); assert.match(text, /\[Page 1\]/); assert.match(text, /\[Page 2\]/); const result = await new DeterministicExtractionProvider().extract({ filename:'pediatrics-text.pdf', text }); assert.equal(result.candidates[0]?.page, 1); const scannedData = await readFile('test/fixtures/pediatrics-scanned.pdf'); await assert.rejects(() => extractText(new File([scannedData], 'pediatrics-scanned.pdf')), /OCR_REQUIRED/); });
test('extracts bilingual Arabic and English PDF text in the Workers-compatible parser', async () => { const data = await readFile('test/fixtures/pediatrics-bilingual.pdf'); const text = await extractText(new File([data], 'pediatrics-bilingual.pdf')); assert.match(text, /Pediatrics/); assert.match(text, /[\u0600-\u06ff]/u); const result = await new DeterministicExtractionProvider().extract({ filename:'pediatrics-bilingual.pdf', text }); assert.equal(result.specialtyId, 'PEDIATRICS'); assert.equal(result.candidates.some((candidate) => candidate.kind === 'QUESTION'), true); });
