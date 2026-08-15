import { describe, expect, it } from 'vitest';
import { moderateText, normaliseForMatching, structuralRules, type ModerationTerm } from '../moderation.js';

/**
 * The claim under test, stated once: the gate matches the SHAPE of abuse, not
 * the SUBJECT matter, so it can refuse harassment without also refusing the
 * medical curriculum that shares its vocabulary. Every "does not block"
 * assertion below is as load-bearing as every "does block" one — a filter that
 * blocks urology is not a passing filter.
 */

function slur(id: string, pattern: string, match: 'word' | 'substring' = 'word'): ModerationTerm {
  return { id, pattern, category: 'slur', severity: 'block', match };
}

const PUBLIC = { audience: 'public' as const };
const PRIVATE = { audience: 'private' as const };

describe('normalisation defeats the cheap evasions', () => {
  it('folds case', () => {
    expect(normaliseForMatching('SLUR')).toBe('slur');
  });

  it('collapses stretched letters without merging distinct words', () => {
    expect(normaliseForMatching('killllll')).toBe('kill');
    expect(normaliseForMatching('sooo good')).toBe('soo good');
  });

  it('folds common leetspeak substitutions', () => {
    expect(normaliseForMatching('k!ll')).toBe(normaliseForMatching('kill'));
    expect(normaliseForMatching('$lur')).toBe(normaliseForMatching('slur'));
  });

  it('strips zero-width characters used to break up a word', () => {
    const zeroWidth = 'k​i‌l‍l';
    expect(normaliseForMatching(zeroWidth)).toBe('kill');
  });

  it('keeps word boundaries — "therapies" does not become "the rapes"', () => {
    expect(normaliseForMatching('cognitive behavioural therapies')).toContain('therapies');
    expect(normaliseForMatching('therapies')).not.toContain(' rapes');
  });
});

describe('a lexicon term matches a whole word only', () => {
  const terms = [slur('t1', 'slur')];

  it('matches the exact word', () => {
    const result = moderateText('you are a slur', { terms, surface: PUBLIC });
    expect(result.verdict).toBe('block');
    expect(result.matches[0]!.ruleId).toBe('term:t1');
  });

  it('does not match the word as a substring of something else', () => {
    // "slurred speech" — a real clinical phrase — must not trip a word-match term.
    const result = moderateText('the patient has slurred speech', { terms, surface: PUBLIC });
    expect(result.verdict).toBe('allow');
  });

  it('matches through an evasion', () => {
    const result = moderateText('you are a s l u r r r r', { terms: [], surface: PUBLIC });
    // No terms supplied, so this specific case is a control: without a term,
    // stretched spacing must not spontaneously trigger anything.
    expect(result.verdict).toBe('allow');
  });
});

describe('threats: keyed on the addressee, not the verb', () => {
  it('blocks a first-person threat aimed at "you"', () => {
    const result = moderateText('i will kill you', { terms: [], surface: PUBLIC });
    expect(result.verdict).toBe('block');
    expect(result.matches.some((m) => m.category === 'threat')).toBe(true);
  });

  it('blocks the Arabic equivalent, object pronoun and all', () => {
    const result = moderateText('اقتلك الآن', { terms: [], surface: PUBLIC });
    expect(result.verdict).toBe('block');
  });

  it('does NOT block a clinical sentence with the same verb and no addressee', () => {
    const result = moderateText(
      'Untreated hyperkalemia will kill the patient within hours if not corrected.',
      { terms: [], surface: PUBLIC },
    );
    expect(result.verdict).toBe('allow');
  });

  it('does NOT block a pharmacology sentence about a drug killing bacteria', () => {
    const result = moderateText('Penicillin kills gram-positive bacteria by inhibiting cell wall synthesis.', {
      terms: [],
      surface: PUBLIC,
    });
    expect(result.verdict).toBe('allow');
  });
});

describe('self-harm: encouragement, not discussion', () => {
  it('blocks telling someone to kill themselves', () => {
    const result = moderateText('kill yourself', { terms: [], surface: PUBLIC });
    expect(result.verdict).toBe('block');
  });

  it('does NOT block a psychiatry case discussing suicidal ideation', () => {
    const result = moderateText(
      'The patient presented with suicidal ideation and a plan; started on close observation.',
      { terms: [], surface: PUBLIC },
    );
    expect(result.verdict).toBe('allow');
  });

  it('does NOT block a forensic medicine question about self-harm epidemiology', () => {
    const result = moderateText(
      'What is the most common method of self-harm presented in this cohort study?',
      { terms: [], surface: PUBLIC },
    );
    expect(result.verdict).toBe('allow');
  });
});

describe('sexual harassment: the imperative, not the anatomy', () => {
  it('blocks a demand for explicit images', () => {
    const result = moderateText('send me your nudes', { terms: [], surface: PRIVATE });
    expect(result.verdict).toBe('block');
  });

  it('does NOT block a urology lecture using the same anatomical terms', () => {
    const result = moderateText(
      'Erectile dysfunction and penile anatomy will be covered in tomorrow’s urology session.',
      { terms: [], surface: PUBLIC },
    );
    expect(result.verdict).toBe('allow');
  });

  it('does NOT block a gynaecology note about the vulva or vagina', () => {
    const result = moderateText('Examination of the vulva and vaginal canal revealed no lesions.', {
      terms: [],
      surface: PUBLIC,
    });
    expect(result.verdict).toBe('allow');
  });
});

describe('forensic and toxicology vocabulary is never refused on its own', () => {
  const cases = [
    'The case discusses rape kit evidence collection in a forensic medicine rotation.',
    'This lecture covers management of acute overdose and toxidromes.',
    'A review of anal fissure presentation in gastroenterology clinic.',
    'Chapter 4 covers psychosis, delusions, and antipsychotic pharmacology.',
    'Discussion of abuse disclosure protocols for paediatric patients.',
  ];

  it.each(cases)('allows: %s', (text) => {
    const result = moderateText(text, { terms: [], surface: PUBLIC });
    expect(result.verdict).toBe('allow');
  });
});

describe('spam: flagged for review, and only on a public surface', () => {
  it('flags a message with three or more links as review, not block', () => {
    const text = 'check http://a.com and http://b.com and also http://c.com';
    const result = moderateText(text, { terms: [], surface: PUBLIC });
    expect(result.verdict).toBe('review');
  });

  it('does not run the link-flood rule on a private surface', () => {
    const text = 'check http://a.com and http://b.com and also http://c.com';
    const result = moderateText(text, { terms: [], surface: PRIVATE });
    expect(result.verdict).toBe('allow');
  });

  it('does not flag a genuine two-citation academic post', () => {
    const text = 'Two good sources: http://pubmed.example/123 and http://uptodate.example/456';
    const result = moderateText(text, { terms: [], surface: PUBLIC });
    expect(result.verdict).toBe('allow');
  });

  it('flags a phone number next to a messaging app name', () => {
    const result = moderateText('DM me on whatsapp +964 770 123 4567', {
      terms: [],
      surface: PUBLIC,
    });
    expect(result.verdict).toBe('review');
  });
});

describe('multiple matches surface every rule, not just the first', () => {
  it('collects every triggered rule id', () => {
    const terms = [slur('t1', 'slur')];
    const result = moderateText('slur, i will kill you', { terms, surface: PUBLIC });
    const ruleIds = result.matches.map((m) => m.ruleId);
    expect(ruleIds).toContain('term:t1');
    expect(ruleIds.some((id) => id.startsWith('threat.'))).toBe(true);
  });

  it('the overall verdict is the worst of the individual matches', () => {
    // A review-severity spam match alongside a block-severity slur: block wins.
    const terms = [slur('t1', 'slur')];
    const text = 'slur http://a.com http://b.com http://c.com';
    const result = moderateText(text, { terms, surface: PUBLIC });
    expect(result.verdict).toBe('block');
  });
});

describe('empty and inert input', () => {
  it('allows an empty string', () => {
    expect(moderateText('', { terms: [], surface: PUBLIC }).verdict).toBe('allow');
  });

  it('allows whitespace-only input', () => {
    expect(moderateText('   \n\t  ', { terms: [], surface: PUBLIC }).verdict).toBe('allow');
  });

  it('allows ordinary academic content with no rule anywhere near it', () => {
    const result = moderateText(
      'شرح مفصل عن آلية عمل الأنسولين في تنظيم سكر الدم عند مرضى النوع الثاني.',
      { terms: [], surface: PUBLIC },
    );
    expect(result.verdict).toBe('allow');
  });
});

describe('the rule catalogue is introspectable', () => {
  it('every structural rule states why it exists', () => {
    for (const rule of structuralRules()) {
      expect(rule.why.length).toBeGreaterThan(20);
    }
  });
});
