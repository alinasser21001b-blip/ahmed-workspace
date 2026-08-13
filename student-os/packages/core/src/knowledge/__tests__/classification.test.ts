import { describe, expect, it } from 'vitest';
import {
  allowedKnowledgeTypes,
  detectLanguage,
  impliedKnowledgeType,
  isKnowledgeTypeAllowed,
  needsReaderCaution,
  provenanceOf,
  type KnowledgeSignals,
} from '../classification.js';

/**
 * Knowledge classification.
 *
 * These rules decide what the taxonomy can express, which is the one thing in
 * Phase 5 that cannot be fixed later without a backfill — content published
 * under a wrong rule stays wrong.
 */

describe('the two axes', () => {
  it('lets one render kind carry several knowledge types', () => {
    // The reason `knowledge_type` exists at all: a case and a summary are both
    // plain posts and are not the same knowledge (ADR-0012).
    const forPost = allowedKnowledgeTypes('post');
    expect(forPost).toContain('explanation');
    expect(forPost).toContain('case');
    expect(forPost).toContain('summary');
  });

  it('pins a question to exactly one', () => {
    expect(allowedKnowledgeTypes('question')).toEqual(['question']);
    expect(impliedKnowledgeType('question')).toBe('question');
  });

  it('implies nothing for kinds that are genuinely ambiguous', () => {
    // Which is why the composer asks rather than guessing.
    expect(impliedKnowledgeType('post')).toBeNull();
    expect(impliedKnowledgeType('resource')).toBeNull();
  });

  it('refuses combinations that would put content in a useless filter', () => {
    expect(isKnowledgeTypeAllowed('poll', 'summary')).toBe(false);
    expect(isKnowledgeTypeAllowed('question', 'explanation')).toBe(false);
    expect(isKnowledgeTypeAllowed('post', 'question')).toBe(false);
  });

  it('gives reels and live sessions no knowledge type at all', () => {
    // Not an oversight. They are not part of the product's centre of gravity,
    // and giving them a token classification would put them in academic
    // surfaces by default.
    expect(allowedKnowledgeTypes('reel')).toEqual([]);
    expect(allowedKnowledgeTypes('live')).toEqual([]);
  });
});

describe('detectLanguage', () => {
  it('recognises Arabic prose', () => {
    expect(detectLanguage('مراجعة سريعة لليرقان الوليدي عند الأطفال')).toBe('ar');
  });

  it('recognises English prose', () => {
    expect(detectLanguage('Quick clinical pearl on nephrotic syndrome in children')).toBe('en');
  });

  it('calls genuinely bilingual text mixed, rather than picking a winner', () => {
    /*
     * This cohort writes Arabic prose with English drug and disease names in it
     * constantly. Forcing that into `ar` or `en` throws away the fact that
     * matters most for reading it and for searching it.
     */
    expect(
      detectLanguage('ملخص محاضرة اليوم عن Respiratory Distress Syndrome والـ surfactant'),
    ).toBe('mixed');
  });

  it('tolerates a minority of foreign terms without flipping', () => {
    expect(
      detectLanguage(
        'اليرقان الفسيولوجي يظهر بعد أربع وعشرين ساعة من الولادة ويختفي خلال أسبوعين تقريباً عند أغلب الأطفال bilirubin',
      ),
    ).toBe('ar');
  });

  it('refuses to classify text too short to judge', () => {
    // `und` is an honest answer. Guessing from three letters would produce a
    // filter that quietly drops posts.
    expect(detectLanguage('ok')).toBe('und');
    expect(detectLanguage('نعم')).toBe('und');
    expect(detectLanguage('')).toBe('und');
    expect(detectLanguage(null)).toBe('und');
  });

  it('ignores digits, punctuation and emoji when weighing scripts', () => {
    expect(detectLanguage('القلب ٢٠٢٥ !!! 🙏 والكلى والرئتين')).toBe('ar');
  });

  it('is deterministic — the same body always gives the same answer', () => {
    const body = 'ملخص عن Nephrotic Syndrome';
    const first = detectLanguage(body);
    for (let i = 0; i < 5; i += 1) expect(detectLanguage(body)).toBe(first);
  });
});

describe('provenance', () => {
  const none: KnowledgeSignals = {
    sourceCount: 0,
    acceptedCorrectionCount: 0,
    openCorrectionCount: 0,
    helpfulCount: 0,
    hasAcceptedAnswer: false,
  };

  it('calls an uncited student note exactly what it is', () => {
    // `author_claim` is the honest default, not a criticism. Most of the value
    // in a cohort's notes is uncited and worth reading.
    expect(provenanceOf(none)).toBe('author_claim');
  });

  it('recognises a citation', () => {
    expect(provenanceOf({ ...none, sourceCount: 2 })).toBe('source_backed');
  });

  it('puts an accepted correction above everything else', () => {
    // Whatever else is true of this content, the reader needs the correction
    // first — including when it is well sourced.
    expect(provenanceOf({ ...none, sourceCount: 3, acceptedCorrectionCount: 1 })).toBe('corrected');
  });

  it('marks an unresolved challenge as disputed, not as corrected', () => {
    expect(provenanceOf({ ...none, openCorrectionCount: 1 })).toBe('disputed');
    expect(provenanceOf({ ...none, sourceCount: 5, openCorrectionCount: 1 })).toBe('disputed');
  });

  it('never blends signals into a score', () => {
    /*
     * The property this test defends (ADR-0013): provenance is chosen by rules
     * over facts, so two pieces of content with different facts can share a
     * class, and the class never becomes a number a reader cannot argue with.
     */
    const wellLiked = provenanceOf({ ...none, helpfulCount: 50 });
    const ignored = provenanceOf({ ...none, helpfulCount: 0 });
    expect(wellLiked).toBe(ignored);
    expect(wellLiked).toBe('author_claim');
  });
});

describe('needsReaderCaution', () => {
  const none: KnowledgeSignals = {
    sourceCount: 0,
    acceptedCorrectionCount: 0,
    openCorrectionCount: 0,
    helpfulCount: 0,
    hasAcceptedAnswer: false,
  };

  it('warns only when accuracy has actually been questioned', () => {
    expect(needsReaderCaution({ ...none, acceptedCorrectionCount: 1 })).toBe(true);
    expect(needsReaderCaution({ ...none, openCorrectionCount: 1 })).toBe(true);
  });

  it('does not warn about an ordinary uncited note', () => {
    // Warning on every uncited post would train readers to ignore warnings,
    // which costs exactly the cases the warning exists for.
    expect(needsReaderCaution(none)).toBe(false);
    expect(needsReaderCaution({ ...none, sourceCount: 1 })).toBe(false);
  });
});
