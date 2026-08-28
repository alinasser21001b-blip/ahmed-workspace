import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getStore } from '@/data/store';
import type { ExtractionCandidate, KnowledgeDocument, SpecialtyId } from '@/domain/models';
import { HIGH_CONFIDENCE_THRESHOLD } from '@/domain/models';
import { parseDocument, fileTypeFromName } from '@/domain/ingestion/parse';
import { extractKnowledge } from '@/domain/ingestion/extract';
import { applyApprovedCandidates } from '@/domain/ingestion/apply';
import { createId, nowIso } from '@/lib/ids';

export async function ingestUpload(input: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  department?: SpecialtyId;
  sourceYear?: number;
}): Promise<{ document: KnowledgeDocument; candidates: ExtractionCandidate[] }> {
  const documentId = createId('doc');
  const version = Date.now();
  const uploadedAt = nowIso();
  const fileType = fileTypeFromName(input.filename);

  const initial: KnowledgeDocument = {
    id: documentId,
    filename: input.filename,
    fileType,
    uploadedAt,
    processingStatus: 'UPLOADED',
    department: input.department,
    sourceYear: input.sourceYear,
    version,
  };

  await getStore().write((store) => {
    store.documents.unshift(initial);
  });

  await getStore().write((store) => {
    const doc = store.documents.find((row) => row.id === documentId);
    if (doc) doc.processingStatus = 'PROCESSING';
  });

  try {
    const parsed = await parseDocument(input.buffer, input.filename, input.mimeType);
    const uploadDir = path.join(process.cwd(), 'data', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, `${documentId}__${input.filename}`), input.buffer);

    const store = await getStore().read();
    const extracted = extractKnowledge(parsed.text, {
      documentId,
      examiners: store.examiners,
      cases: store.cases,
    });

    const withDepartment = extracted.map((candidate) => ({
      ...candidate,
      specialtyId: candidate.specialtyId ?? input.department,
      year: candidate.year ?? input.sourceYear,
    }));

    const high = withDepartment.filter(
      (candidate) => !candidate.reviewRequired && candidate.confidence >= HIGH_CONFIDENCE_THRESHOLD,
    );
    const rest = withDepartment.filter((candidate) => !high.includes(candidate));

    const autoApproved = high.map((candidate) => ({ ...candidate, decision: 'APPROVED' as const }));

    await getStore().write((store) => {
      const doc = store.documents.find((row) => row.id === documentId);
      if (!doc) return;
      doc.originalText = parsed.text.slice(0, 20000);
      doc.processedAt = nowIso();
      if (parsed.text.length === 0) {
        doc.processingStatus = 'FAILED';
        doc.error = parsed.warnings.join(' ') || 'No text extracted.';
        return;
      }

      store.candidates.unshift(...autoApproved, ...rest);

      if (autoApproved.length > 0) {
        const mutated = applyApprovedCandidates(autoApproved, store, doc);
        store.examiners = mutated.examiners;
        store.cases = mutated.cases;
        store.questions = mutated.questions;
        store.examinerQuestions = mutated.examinerQuestions;
        store.occurrences = mutated.occurrences;
      }

      const needsReview = rest.length > 0 || parsed.warnings.length > 0;
      doc.processingStatus = needsReview ? 'REVIEW_REQUIRED' : 'PROCESSED';
      if (parsed.warnings.length) doc.error = parsed.warnings.join(' ');
    });
  } catch (error) {
    await getStore().write((store) => {
      const doc = store.documents.find((row) => row.id === documentId);
      if (!doc) return;
      doc.processingStatus = 'FAILED';
      doc.error = error instanceof Error ? error.message : 'Processing failed';
    });
  }

  const latest = await getStore().read();
  const document = latest.documents.find((row) => row.id === documentId) ?? initial;
  const candidates = latest.candidates.filter((row) => row.documentId === documentId);
  return { document, candidates };
}
