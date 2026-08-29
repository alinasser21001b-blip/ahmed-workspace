/**
 * Controlled medical vocabulary: the engine's substitute for an embedding model.
 *
 * The problem this solves: a student writes "DVT", the approved key point says
 * "deep vein thrombosis". No amount of string similarity connects those two.
 * The industry reflex is to reach for embeddings or an LLM judge. That buys
 * paraphrase recall at the cost of determinism, latency, per-call cost, and
 * the ability to explain a mark to a student who disputes it.
 *
 * The alternative implemented here is the same one UMLS uses at national scale,
 * shrunk to the size of one exam corpus: map every surface form to a concept
 * identifier, then compare concept sets instead of strings. Two texts are
 * semantically equal when they name the same concepts.
 *
 * Properties this buys:
 *   - deterministic and reproducible across deploys
 *   - explainable: "you were marked as covering DVT because you wrote 'DVT'"
 *   - editable by a medical reviewer without a retraining cycle
 *   - microseconds per lookup, no network call
 *   - it can be wrong, but it is wrong *visibly*, in a table a human can fix
 *
 * The trade-off is honest: recall is bounded by the vocabulary. A paraphrase
 * that uses no listed surface form is missed. Section `unmatchedTerms` in the
 * evaluation result exists precisely to feed those misses back to the reviewer,
 * turning the ceiling into a work queue rather than a silent failure.
 */

import { normalizeForMatching } from './normalize.ts';
import { stemToken } from './tokenize.ts';

/** One concept: a set of surface forms that mean the same thing. */
export interface ConceptEntry {
  /** Stable concept identifier, e.g. 'C:DVT'. */
  readonly id: string;
  /** Preferred display term. */
  readonly preferred: string;
  /** All accepted surface forms, in any script. */
  readonly forms: readonly string[];
  /** Optional broader concept, enabling partial credit for a less specific answer. */
  readonly broader?: string;
}

/**
 * Seed vocabulary.
 *
 * Deliberately small and illustrative rather than exhaustive: the shipping
 * artefact is the *mechanism*, and the vocabulary is content that a medical
 * reviewer owns and grows from the `unmatchedTerms` report. Every entry below
 * is a term that appears in ordinary OSCE recall material.
 */
export const SEED_CONCEPTS: readonly ConceptEntry[] = Object.freeze([
  // --- Vascular / haematological -----------------------------------------
  { id: 'C:DVT', preferred: 'deep vein thrombosis', forms: ['dvt', 'deep vein thrombosis', 'deep venous thrombosis', 'جلطة وريدية عميقة', 'خثار وريدي عميق'], broader: 'C:THROMBOSIS' },
  { id: 'C:PE', preferred: 'pulmonary embolism', forms: ['pe', 'pulmonary embolism', 'pulmonary embolus', 'انصمام رئوي', 'صمة رئوية'], broader: 'C:THROMBOSIS' },
  { id: 'C:THROMBOSIS', preferred: 'thrombosis', forms: ['thrombosis', 'thrombus', 'clot', 'clotting', 'جلطة', 'خثار'] },
  { id: 'C:HAEMORRHAGE', preferred: 'haemorrhage', forms: ['haemorrhage', 'hemorrhage', 'bleeding', 'bleed', 'blood loss', 'نزف', 'نزيف'] },
  { id: 'C:ANAEMIA', preferred: 'anaemia', forms: ['anaemia', 'anemia', 'low haemoglobin', 'low hemoglobin', 'فقر دم', 'انيميا'] },
  { id: 'C:HYPOVOLAEMIA', preferred: 'hypovolaemia', forms: ['hypovolaemia', 'hypovolemia', 'hypovolaemic shock', 'hypovolemic shock', 'volume depletion', 'نقص حجم الدم'] },

  // --- Infection -----------------------------------------------------------
  { id: 'C:INFECTION', preferred: 'infection', forms: ['infection', 'infected', 'sepsis', 'septic', 'التهاب', 'عدوي', 'انتان'] },
  { id: 'C:WOUND_INFECTION', preferred: 'wound infection', forms: ['wound infection', 'surgical site infection', 'ssi', 'التهاب الجرح'], broader: 'C:INFECTION' },
  { id: 'C:ABSCESS', preferred: 'abscess', forms: ['abscess', 'collection', 'خراج'], broader: 'C:INFECTION' },
  { id: 'C:PNEUMONIA', preferred: 'pneumonia', forms: ['pneumonia', 'chest infection', 'lrti', 'التهاب رئوي', 'ذات الرئة'], broader: 'C:INFECTION' },

  // --- Cardiorespiratory ---------------------------------------------------
  { id: 'C:MI', preferred: 'myocardial infarction', forms: ['mi', 'myocardial infarction', 'heart attack', 'stemi', 'nstemi', 'احتشاء عضلة القلب', 'جلطة قلبية'] },
  { id: 'C:HTN', preferred: 'hypertension', forms: ['htn', 'hypertension', 'high blood pressure', 'raised bp', 'ارتفاع ضغط الدم', 'ضغط مرتفع'] },
  { id: 'C:HYPOTENSION', preferred: 'hypotension', forms: ['hypotension', 'low blood pressure', 'low bp', 'انخفاض ضغط الدم'] },
  { id: 'C:AF', preferred: 'atrial fibrillation', forms: ['af', 'atrial fibrillation', 'رجفان اذيني'] },
  { id: 'C:CHF', preferred: 'heart failure', forms: ['chf', 'heart failure', 'congestive heart failure', 'cardiac failure', 'قصور القلب', 'فشل القلب'] },
  { id: 'C:COPD', preferred: 'chronic obstructive pulmonary disease', forms: ['copd', 'chronic obstructive pulmonary disease', 'انسداد رئوي مزمن'] },
  { id: 'C:ASTHMA', preferred: 'asthma', forms: ['asthma', 'ربو'] },
  { id: 'C:DYSPNOEA', preferred: 'dyspnoea', forms: ['dyspnoea', 'dyspnea', 'shortness of breath', 'sob', 'breathlessness', 'ضيق نفس', 'ضيق تنفس'] },

  // --- Endocrine / metabolic ----------------------------------------------
  { id: 'C:DM', preferred: 'diabetes mellitus', forms: ['dm', 'diabetes', 'diabetes mellitus', 't2dm', 't1dm', 'سكري', 'داء السكري'] },
  { id: 'C:HYPOGLYCAEMIA', preferred: 'hypoglycaemia', forms: ['hypoglycaemia', 'hypoglycemia', 'low blood sugar', 'low glucose', 'نقص سكر الدم'] },
  { id: 'C:DKA', preferred: 'diabetic ketoacidosis', forms: ['dka', 'diabetic ketoacidosis', 'الحماض الكيتوني'] },
  { id: 'C:THYROID', preferred: 'thyroid disease', forms: ['thyroid', 'hypothyroidism', 'hyperthyroidism', 'goitre', 'goiter', 'الغدة الدرقية'] },

  // --- Renal / GI ----------------------------------------------------------
  { id: 'C:AKI', preferred: 'acute kidney injury', forms: ['aki', 'acute kidney injury', 'acute renal failure', 'arf', 'فشل كلوي حاد', 'قصور كلوي حاد'] },
  { id: 'C:UTI', preferred: 'urinary tract infection', forms: ['uti', 'urinary tract infection', 'التهاب المسالك البولية'], broader: 'C:INFECTION' },
  { id: 'C:APPENDICITIS', preferred: 'appendicitis', forms: ['appendicitis', 'التهاب الزائدة', 'الزائدة الدودية'] },
  { id: 'C:OBSTRUCTION', preferred: 'bowel obstruction', forms: ['bowel obstruction', 'intestinal obstruction', 'ileus', 'انسداد امعاء', 'انسداد معوي'] },
  { id: 'C:PERFORATION', preferred: 'perforation', forms: ['perforation', 'perforated', 'rupture', 'ruptured', 'انثقاب', 'ثقب'] },
  { id: 'C:ADHESION', preferred: 'adhesions', forms: ['adhesion', 'adhesions', 'التصاقات'] },

  // --- Symptoms / signs ----------------------------------------------------
  { id: 'C:FEVER', preferred: 'fever', forms: ['fever', 'pyrexia', 'febrile', 'high temperature', 'حمي', 'ارتفاع حرارة', 'سخونة'] },
  { id: 'C:PAIN', preferred: 'pain', forms: ['pain', 'painful', 'ache', 'tenderness', 'الم', 'وجع'] },
  { id: 'C:VOMITING', preferred: 'vomiting', forms: ['vomiting', 'vomit', 'emesis', 'تقيؤ', 'استفراغ'] },
  { id: 'C:NAUSEA', preferred: 'nausea', forms: ['nausea', 'nauseated', 'غثيان'] },
  { id: 'C:JAUNDICE', preferred: 'jaundice', forms: ['jaundice', 'icterus', 'yellow discoloration', 'يرقان', 'صفار'] },
  { id: 'C:OEDEMA', preferred: 'oedema', forms: ['oedema', 'edema', 'swelling', 'swollen', 'وذمة', 'تورم', 'انتفاخ'] },
  { id: 'C:WEIGHT_LOSS', preferred: 'weight loss', forms: ['weight loss', 'losing weight', 'cachexia', 'نقص وزن', 'فقدان الوزن'] },

  // --- Investigations ------------------------------------------------------
  { id: 'C:CBC', preferred: 'full blood count', forms: ['cbc', 'fbc', 'full blood count', 'complete blood count', 'صورة دم كاملة', 'تعداد الدم'] },
  { id: 'C:CXR', preferred: 'chest x-ray', forms: ['cxr', 'chest x ray', 'chest xray', 'chest radiograph', 'اشعة صدر', 'صورة صدر'] },
  { id: 'C:CT', preferred: 'CT scan', forms: ['ct', 'ct scan', 'computed tomography', 'cat scan', 'اشعة مقطعية', 'طبقي محوري'] },
  { id: 'C:USS', preferred: 'ultrasound', forms: ['uss', 'ultrasound', 'sonography', 'echo', 'سونار', 'موجات فوق صوتية', 'ايكو'] },
  { id: 'C:MRI', preferred: 'MRI', forms: ['mri', 'magnetic resonance', 'رنين مغناطيسي'] },
  { id: 'C:ECG', preferred: 'ECG', forms: ['ecg', 'ekg', 'electrocardiogram', 'تخطيط قلب', 'رسم قلب'] },
  { id: 'C:LFT', preferred: 'liver function tests', forms: ['lft', 'lfts', 'liver function test', 'liver function tests', 'وظائف كبد'] },
  { id: 'C:RFT', preferred: 'renal function tests', forms: ['rft', 'u&e', 'urea and electrolytes', 'renal function', 'وظائف كلي'] },
  { id: 'C:CULTURE', preferred: 'culture and sensitivity', forms: ['culture', 'c&s', 'culture and sensitivity', 'blood culture', 'زرع', 'مزرعة'] },

  // --- Management ----------------------------------------------------------
  { id: 'C:ANTIBIOTIC', preferred: 'antibiotics', forms: ['antibiotic', 'antibiotics', 'antimicrobial', 'مضاد حيوي', 'مضادات حيوية'] },
  { id: 'C:ANALGESIA', preferred: 'analgesia', forms: ['analgesia', 'analgesic', 'pain relief', 'painkiller', 'مسكن', 'مسكنات'] },
  { id: 'C:IV_FLUIDS', preferred: 'IV fluids', forms: ['iv fluid', 'iv fluids', 'intravenous fluids', 'fluid resuscitation', 'محاليل وريدية', 'سوائل وريدية'] },
  { id: 'C:SURGERY', preferred: 'surgery', forms: ['surgery', 'surgical', 'operation', 'operative', 'laparotomy', 'جراحة', 'عملية'] },
  { id: 'C:ANTICOAGULATION', preferred: 'anticoagulation', forms: ['anticoagulation', 'anticoagulant', 'heparin', 'warfarin', 'lmwh', 'مضاد تخثر', 'سيولة'] },
  { id: 'C:OXYGEN', preferred: 'oxygen', forms: ['oxygen', 'o2', 'اكسجين'] },
  { id: 'C:REFERRAL', preferred: 'referral', forms: ['referral', 'refer', 'refer to specialist', 'احالة', 'تحويل'] },

  // --- Prophylaxis / prevention -------------------------------------------
  { id: 'C:PROPHYLAXIS', preferred: 'prophylaxis', forms: ['prophylaxis', 'prophylactic', 'prevention', 'preventive', 'وقاية', 'علاج وقائي'] },
  { id: 'C:EARLY_MOBILISATION', preferred: 'early mobilisation', forms: ['early mobilisation', 'early mobilization', 'early ambulation', 'mobilise', 'تحريك مبكر'] },
]);

export interface LexiconMatch {
  readonly conceptId: string;
  readonly preferred: string;
  /** The surface form that matched, in normalized form. */
  readonly surfaceForm: string;
  /** Token index range in the input that produced this match. */
  readonly start: number;
  readonly end: number;
}

/**
 * Compiled vocabulary index.
 *
 * Built once at module load (or once per admin edit) and then read-only. The
 * index is a trie-free approach: forms are bucketed by token length so that
 * matching is a bounded window scan rather than a scan over all entries.
 * Longest-form-first matching prevents "deep vein thrombosis" from being
 * consumed as three separate one-token concepts.
 */
export class Lexicon {
  /** normalized form -> concept id */
  private readonly formIndex = new Map<string, string>();
  /** stemmed normalized form -> concept id (fallback for inflected surface forms) */
  private readonly stemIndex = new Map<string, string>();
  private readonly concepts = new Map<string, ConceptEntry>();
  private readonly maxFormTokens: number;

  constructor(entries: readonly ConceptEntry[] = SEED_CONCEPTS) {
    let maxTokens = 1;
    for (const entry of entries) {
      this.concepts.set(entry.id, entry);
      for (const form of entry.forms) {
        const normalized = normalizeForMatching(form);
        if (normalized.length === 0) continue;
        const tokens = normalized.split(' ');
        if (tokens.length > maxTokens) maxTokens = tokens.length;
        // First writer wins: earlier entries take precedence on an ambiguous form.
        if (!this.formIndex.has(normalized)) this.formIndex.set(normalized, entry.id);
        const stemmed = tokens.map(stemToken).join(' ');
        if (!this.stemIndex.has(stemmed)) this.stemIndex.set(stemmed, entry.id);
      }
    }
    this.maxFormTokens = maxTokens;
  }

  get size(): number {
    return this.concepts.size;
  }

  getConcept(id: string): ConceptEntry | undefined {
    return this.concepts.get(id);
  }

  /**
   * Greedy longest-match scan over a normalized token list.
   *
   * Returns matches in input order. Overlapping matches are resolved in favour
   * of the longer form, so "deep vein thrombosis" wins over "thrombosis".
   */
  annotate(tokens: readonly string[]): LexiconMatch[] {
    const out: LexiconMatch[] = [];
    let i = 0;
    while (i < tokens.length) {
      let matched = false;
      const maxWindow = Math.min(this.maxFormTokens, tokens.length - i);
      for (let width = maxWindow; width >= 1; width--) {
        const window = tokens.slice(i, i + width);
        const phrase = window.join(' ');
        let conceptId = this.formIndex.get(phrase);
        if (conceptId === undefined) {
          conceptId = this.stemIndex.get(window.map(stemToken).join(' '));
        }
        if (conceptId !== undefined) {
          const concept = this.concepts.get(conceptId) as ConceptEntry;
          out.push({
            conceptId,
            preferred: concept.preferred,
            surfaceForm: phrase,
            start: i,
            end: i + width,
          });
          i += width;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    }
    return out;
  }

  /** Concept ids present in a token list. */
  conceptsIn(tokens: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const m of this.annotate(tokens)) out.add(m.conceptId);
    return out;
  }

  /**
   * Expands a concept set with its `broader` ancestors.
   *
   * Enables graded credit: a student who answers "thrombosis" where the key
   * point is "deep vein thrombosis" has said something true but less specific.
   * The evaluator can award partial rather than zero for that.
   */
  withBroader(conceptIds: ReadonlySet<string>): Set<string> {
    const out = new Set(conceptIds);
    for (const id of conceptIds) {
      let current = this.concepts.get(id)?.broader;
      let guard = 0;
      while (current !== undefined && guard++ < 8) {
        out.add(current);
        current = this.concepts.get(current)?.broader;
      }
    }
    return out;
  }

  /** True when `specific` is the same concept as `general` or narrower than it. */
  isNarrowerOrEqual(specific: string, general: string): boolean {
    if (specific === general) return true;
    let current = this.concepts.get(specific)?.broader;
    let guard = 0;
    while (current !== undefined && guard++ < 8) {
      if (current === general) return true;
      current = this.concepts.get(current)?.broader;
    }
    return false;
  }
}

/** Shared default instance. Replace via constructor injection to A/B a vocabulary. */
export const defaultLexicon = new Lexicon();
