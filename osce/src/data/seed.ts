import type {
  ClinicalCase,
  Examiner,
  ExaminerQuestion,
  Question,
  QuestionOccurrence,
  QuestionCategory,
  SpecialtyId,
} from '../domain/models';

/**
 * SAMPLE / DEVELOPMENT DATA
 *
 * These records are fixtures so the OSCE engine can be exercised end-to-end
 * before real historical files are uploaded. They are NOT historical examiner
 * records and must never be presented as such.
 */
export const SAMPLE_BANNER =
  'SAMPLE / DEVELOPMENT DATA — not historical examiner records. Replace via knowledge upload.';

function q(
  id: string,
  caseId: string,
  questionText: string,
  expectedAnswer: string,
  category: QuestionCategory,
  explanation?: string,
  variants: string[] = [],
): Question {
  return {
    id,
    caseId,
    questionText,
    expectedAnswer,
    explanation,
    category,
    difficulty: 'standard',
    sourceDocumentIds: ['seed-sample'],
    sample: true,
    canonicalQuestion: questionText,
    observedVariants: variants,
  };
}

export const examiners: Examiner[] = [
  {
    id: 'ex_ahmed_peds',
    name: 'Dr. Ahmed (Sample)',
    nameAr: 'د. أحمد (عيّنة)',
    departmentId: 'pediatrics',
    aliases: ['Dr. Ahmed', 'د. أحمد', 'Ahmed X'],
    active: true,
    metadata: { sample: true, notes: 'Fixture examiner for Pediatrics stations.' },
  },
  {
    id: 'ex_hassan_peds',
    name: 'Dr. Hassan (Sample)',
    nameAr: 'د. حسن (عيّنة)',
    departmentId: 'pediatrics',
    aliases: ['Dr. Hassan', 'د. حسن'],
    active: true,
    metadata: { sample: true },
  },
  {
    id: 'ex_layla_med',
    name: 'Dr. Layla (Sample)',
    nameAr: 'د. ليلى (عيّنة)',
    departmentId: 'internal-medicine',
    aliases: ['Dr. Layla'],
    active: true,
    metadata: { sample: true },
  },
  {
    id: 'ex_omar_med',
    name: 'Dr. Omar (Sample)',
    nameAr: 'د. عمر (عيّنة)',
    departmentId: 'internal-medicine',
    aliases: ['Dr. Omar'],
    active: true,
    metadata: { sample: true },
  },
  {
    id: 'ex_karim_surg',
    name: 'Dr. Karim (Sample)',
    nameAr: 'د. كريم (عيّنة)',
    departmentId: 'surgery',
    aliases: ['Dr. Karim'],
    active: true,
    metadata: { sample: true },
  },
  {
    id: 'ex_nour_surg',
    name: 'Dr. Nour (Sample)',
    nameAr: 'د. نور (عيّنة)',
    departmentId: 'surgery',
    aliases: ['Dr. Nour'],
    active: true,
    metadata: { sample: true },
  },
  {
    id: 'ex_zainab_minor',
    name: 'Dr. Zainab (Sample)',
    nameAr: 'د. زينب (عيّنة)',
    departmentId: 'minor-specialties',
    aliases: ['Dr. Zainab'],
    active: true,
    metadata: { sample: true },
  },
  {
    id: 'ex_mustafa_minor',
    name: 'Dr. Mustafa (Sample)',
    nameAr: 'د. مصطفى (عيّنة)',
    departmentId: 'minor-specialties',
    aliases: ['Dr. Mustafa'],
    active: true,
    metadata: { sample: true },
  },
  {
    id: 'ex_fatima_obgyn',
    name: 'Dr. Fatima (Sample)',
    nameAr: 'د. فاطمة (عيّنة)',
    departmentId: 'obstetrics-gynecology',
    aliases: ['Dr. Fatima'],
    active: true,
    metadata: { sample: true },
  },
  {
    id: 'ex_samir_obgyn',
    name: 'Dr. Samir (Sample)',
    nameAr: 'د. سمير (عيّنة)',
    departmentId: 'obstetrics-gynecology',
    aliases: ['Dr. Samir'],
    active: true,
    metadata: { sample: true },
  },
];

export const cases: ClinicalCase[] = [
  {
    id: 'case_nephrotic',
    departmentId: 'pediatrics',
    title: 'Nephrotic Syndrome',
    titleAr: 'المتلازمة النفروزية',
    clinicalScenario:
      'A 6-year-old boy presents with generalized body swelling for five days. The swelling started around the eyes and then involved the abdomen and legs. His mother reports frothy urine. There is no fever, no sore throat, and no known kidney disease. You are asked to take a focused history and discuss the patient with the examiner.',
    presentation: 'Generalized edema, periorbital then dependent, frothy urine.',
    difficulty: 'standard',
    tags: ['renal', 'edema', 'pediatrics'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_bronchiolitis',
    departmentId: 'pediatrics',
    title: 'Bronchiolitis',
    titleAr: 'التهاب القصيبات',
    clinicalScenario:
      'A 4-month-old infant presents with a 3-day history of runny nose followed by cough, poor feeding, and increasing work of breathing. You are asked to take a focused history and discuss assessment and management.',
    difficulty: 'standard',
    tags: ['respiratory', 'infancy'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_rheumatic',
    departmentId: 'pediatrics',
    title: 'Acute Rheumatic Fever',
    titleAr: 'الحمى الروماتيزمية',
    clinicalScenario:
      'A 10-year-old girl presents with migratory joint pain and fever two weeks after a sore throat. You are asked to take a focused history and discuss Jones criteria and management.',
    difficulty: 'standard',
    tags: ['cardiology', 'rheumatology'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_asthma',
    departmentId: 'pediatrics',
    title: 'Acute Asthma Exacerbation',
    titleAr: 'نوبة ربو حادة',
    clinicalScenario:
      'An 8-year-old known asthmatic presents with increasing wheeze and night cough for two days. You are asked to assess severity and discuss acute and long-term management.',
    difficulty: 'standard',
    tags: ['respiratory', 'asthma'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_febrile_seizure',
    departmentId: 'pediatrics',
    title: 'Febrile Seizure',
    titleAr: 'اختلاج حراري',
    clinicalScenario:
      'A 18-month-old boy is brought after a brief generalized seizure associated with fever. You are asked to take a focused history and counsel the parents.',
    difficulty: 'standard',
    tags: ['neurology', 'fever'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_dka',
    departmentId: 'internal-medicine',
    title: 'Diabetic Ketoacidosis',
    titleAr: 'الحماض الكيتوني السكري',
    clinicalScenario:
      'A 22-year-old man presents with vomiting, abdominal pain, and rapid breathing. He has been thirsty and passing a lot of urine for one week. You are asked to take a focused history and discuss immediate management.',
    difficulty: 'standard',
    tags: ['endocrine', 'emergency'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_hf',
    departmentId: 'internal-medicine',
    title: 'Acute Heart Failure',
    titleAr: 'قصور القلب الحاد',
    clinicalScenario:
      'A 68-year-old woman with previous myocardial infarction presents with orthopnea and ankle swelling. You are asked to take a focused history and discuss assessment.',
    difficulty: 'standard',
    tags: ['cardiology'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_acs',
    departmentId: 'internal-medicine',
    title: 'Acute Coronary Syndrome',
    titleAr: 'المتلازمة الإكليلية الحادة',
    clinicalScenario:
      'A 55-year-old man presents with crushing central chest pain for 40 minutes, radiating to the left arm, with sweating. You are asked to take a focused history and discuss immediate steps.',
    difficulty: 'standard',
    tags: ['cardiology', 'emergency'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_appendicitis',
    departmentId: 'surgery',
    title: 'Acute Appendicitis',
    titleAr: 'التهاب الزائدة الدودية',
    clinicalScenario:
      'A 19-year-old man presents with periumbilical pain migrating to the right iliac fossa, anorexia, and low-grade fever. You are asked to take a focused history and discuss diagnosis and management.',
    difficulty: 'standard',
    tags: ['abdomen', 'emergency'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_acute_abdomen',
    departmentId: 'surgery',
    title: 'Acute Abdomen',
    titleAr: 'بطن جراحي حاد',
    clinicalScenario:
      'A 45-year-old woman presents with sudden severe epigastric pain, board-like rigidity, and a history of peptic ulcer. You are asked to discuss differential diagnosis and initial management.',
    difficulty: 'standard',
    tags: ['abdomen', 'emergency'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_otitis',
    departmentId: 'minor-specialties',
    title: 'Acute Otitis Media',
    titleAr: 'التهاب الأذن الوسطى',
    clinicalScenario:
      'A 3-year-old child presents with ear pain and fever after a recent cold. You are asked to take a focused history and discuss ENT examination findings and management.',
    difficulty: 'introductory',
    tags: ['ent', 'pediatrics'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_red_eye',
    departmentId: 'minor-specialties',
    title: 'Acute Red Eye',
    titleAr: 'العين الحمراء',
    clinicalScenario:
      'A 28-year-old presents with a painful red eye, photophobia, and blurred vision. You are asked to take a focused history and discuss dangerous causes that must not be missed.',
    difficulty: 'standard',
    tags: ['ophthalmology'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_eclampsia',
    departmentId: 'obstetrics-gynecology',
    title: 'Pre-eclampsia / Eclampsia',
    titleAr: 'الارتعاج',
    clinicalScenario:
      'A 28-year-old primigravida at 34 weeks presents with headache, visual spots, and swelling. Blood pressure is 170/110. You are asked to take a focused history and discuss immediate management.',
    difficulty: 'advanced',
    tags: ['obstetrics', 'emergency'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
  {
    id: 'case_pph',
    departmentId: 'obstetrics-gynecology',
    title: 'Postpartum Hemorrhage',
    titleAr: 'النزف بعد الولادة',
    clinicalScenario:
      'A woman has just delivered and is bleeding heavily. The uterus feels boggy. You are asked to discuss causes and stepwise management of PPH.',
    difficulty: 'standard',
    tags: ['obstetrics', 'emergency'],
    sourceDocumentIds: ['seed-sample'],
    sample: true,
  },
];

const nephroticQuestions: Question[] = [
  q(
    'q_ns_01',
    'case_nephrotic',
    'What is the most likely diagnosis?',
    'Nephrotic syndrome.',
    'Diagnosis',
    'Generalized edema, frothy urine, and typical age make nephrotic syndrome the leading working diagnosis in this station.',
    ['Most likely diagnosis?', 'What is the diagnosis?'],
  ),
  q(
    'q_ns_02',
    'case_nephrotic',
    'What are the diagnostic criteria of nephrotic syndrome?',
    'Heavy proteinuria (typically ≥40 mg/m²/hour or urine protein/creatinine ratio ≥2 mg/mg, or ≥3+ protein on dipstick), hypoalbuminemia (albumin <2.5 g/dL), and edema. Hyperlipidemia is usually present.',
    'Diagnosis',
    'State the triad; hyperlipidemia is supportive. Quote units as used in textbooks — they stay in Latin digits.',
  ),
  q(
    'q_ns_03',
    'case_nephrotic',
    'What is the most common cause of nephrotic syndrome in children?',
    'Minimal change disease (minimal change nephropathy).',
    'Diagnosis',
    undefined,
    ['Most common cause of NS in children?', 'Cause?'],
  ),
  q(
    'q_ns_04',
    'case_nephrotic',
    'What are the major complications of nephrotic syndrome?',
    'Infection (including peritonitis), thrombosis, hypovolemia / hypovolemic shock, acute kidney injury, and hyperlipidemia-related complications. Also malnutrition and steroid-related complications during treatment.',
    'Complications',
    undefined,
    ['Complications of NS?', 'What are nephrotic syndrome complications?'],
  ),
  q(
    'q_ns_05',
    'case_nephrotic',
    'Which initial investigations would you request?',
    'Urine dipstick and urine protein/creatinine ratio; serum albumin; renal function; CBC; cholesterol/lipids; ASO / complement if atypical; hepatitis B/C and varicella status as relevant before immunosuppression.',
    'Investigation',
  ),
  q(
    'q_ns_06',
    'case_nephrotic',
    'What is first-line treatment for a typical first presentation in a child?',
    'Oral corticosteroids (prednisolone) according to a standard pediatric nephrotic protocol, plus supportive care: salt restriction, monitor fluid balance, treat infection, and vaccinate as indicated. Admit if the child is young, hypovolemic, or has complications.',
    'Management',
  ),
  q(
    'q_ns_07',
    'case_nephrotic',
    'How do you define steroid-sensitive and steroid-resistant nephrotic syndrome?',
    'Steroid-sensitive: complete remission of proteinuria within 4 weeks of standard steroid therapy. Steroid-resistant: failure to achieve remission after 4 weeks of daily corticosteroids (confirm adherence and exclude infection).',
    'Pharmacology',
  ),
  q(
    'q_ns_08',
    'case_nephrotic',
    'When would you consider a renal biopsy?',
    'Atypical features: age <1 year or older adolescent/adult presentation, persistent hematuria, hypertension, low complement, renal impairment, steroid resistance, or suspected systemic disease.',
    'Investigation',
  ),
  q(
    'q_ns_09',
    'case_nephrotic',
    'When is intravenous albumin used?',
    'Symptomatic hypovolemia, severe edema with intravascular depletion, or tense ascites/scrotal edema with circulatory compromise — typically 20% albumin with cautious diuretic use, not as routine daily treatment of edema.',
    'Management',
  ),
  q(
    'q_ns_10',
    'case_nephrotic',
    'What infection-related points must you mention?',
    'Increased infection risk (encapsulated organisms, primary peritonitis). Avoid live vaccines while immunosuppressed. Pneumococcal and varicella status matter. Fever in a nephrotic child is an emergency until peritonitis/sepsis is excluded.',
    'Emergency',
  ),
  q(
    'q_ns_11',
    'case_nephrotic',
    'What history points would you specifically cover?',
    'Onset and progression of swelling (periorbital vs dependent), urine appearance (frothy, oliguria, hematuria), recent infection, drugs, family history of renal disease, appetite, abdominal pain, and immunization/varicella history.',
    'History',
  ),
  q(
    'q_ns_12',
    'case_nephrotic',
    'What examination findings do you look for?',
    'Periorbital and scrotal/leg edema, ascites, pleural effusion, blood pressure, hydration/perfusion (hypovolemia), abdominal tenderness (peritonitis), and signs of infection or thrombosis.',
    'Examination',
  ),
  q(
    'q_ns_13',
    'case_nephrotic',
    'What is the differential diagnosis of generalized edema in a child?',
    'Nephrotic syndrome, acute glomerulonephritis, hepatic disease, protein-losing enteropathy, severe malnutrition (kwashiorkor), allergic angioedema, and heart failure (less typical as isolated periorbital swelling).',
    'Differential Diagnosis',
  ),
  q(
    'q_ns_14',
    'case_nephrotic',
    'How would you counsel the parents about follow-up and relapse?',
    'Teach urine dipstick monitoring, define relapse (proteinuria 3+ for three consecutive days), when to seek care (fever, abdominal pain, diarrhea, reduced urine, severe swelling), steroid side effects, and that most children with minimal change disease do well but relapses are common.',
    'Follow-up',
  ),
];

function setQuestions(
  prefix: string,
  caseId: string,
  items: Array<[string, string, QuestionCategory, string?]>,
): Question[] {
  return items.map((item, i) => {
    const [questionText, expectedAnswer, category, explanation] = item;
    return q(`${prefix}_${String(i + 1).padStart(2, '0')}`, caseId, questionText, expectedAnswer, category, explanation);
  });
}

const otherQuestions: Question[] = [
  ...setQuestions('q_br', 'case_bronchiolitis', [
    ['What is the most likely diagnosis?', 'Bronchiolitis, most often RSV in this age group.', 'Diagnosis'],
    ['What is the typical age group?', 'Infants under 12 months, especially under 6 months.', 'Diagnosis'],
    ['What are the key examination findings?', 'Tachypnea, chest recession, wheeze and/or crackles, feeding difficulty, possible hypoxia.', 'Examination'],
    ['What is the mainstay of management?', 'Supportive care: oxygen if hypoxic, feeding support, nasal suction, monitor for apnea. No routine bronchodilators, steroids, or antibiotics.', 'Management'],
    ['When would you admit this infant?', 'Age under 3 months, hypoxia, poor feeding/dehydration, apnea, significant work of breathing, or unreliable home care.', 'Emergency'],
    ['What complications concern you?', 'Apnea, respiratory failure, secondary bacterial infection, dehydration.', 'Complications'],
  ]),
  ...setQuestions('q_rf', 'case_rheumatic', [
    ['What is the most likely diagnosis?', 'Acute rheumatic fever.', 'Diagnosis'],
    ['List the Jones criteria major manifestations.', 'Carditis, polyarthritis, chorea, erythema marginatum, subcutaneous nodules.', 'Diagnosis'],
    ['What investigations support the diagnosis?', 'Evidence of preceding streptococcal infection (ASO, anti-DNase B), ESR/CRP, ECG, echocardiography, throat culture if still positive.', 'Investigation'],
    ['How do you treat the acute episode?', 'Anti-inflammatory therapy (aspirin/NSAID or steroids if carditis), plus antibiotic eradication of streptococcus, and bed rest if carditis.', 'Management'],
    ['What is the purpose of long-term penicillin?', 'Secondary prophylaxis to prevent recurrent rheumatic fever and rheumatic heart disease.', 'Pharmacology'],
    ['What cardiac complications must you mention?', 'Valvular heart disease, especially mitral regurgitation, and later stenosis; heart failure; arrhythmia.', 'Complications'],
  ]),
  ...setQuestions('q_as', 'case_asthma', [
    ['How do you assess the severity of this attack?', 'Ability to speak, respiratory rate, accessory muscle use, pulse, SpO2, peak expiratory flow if age-appropriate, and presence of silent chest or exhaustion.', 'Examination'],
    ['Immediate management of an acute attack?', 'Oxygen to target saturations, repeated inhaled salbutamol (MDI+spacer or nebulizer), ipratropium if severe, systemic corticosteroids.', 'Management'],
    ['Life-threatening features?', 'Silent chest, exhaustion, confusion, hypotension, cyanosis, poor respiratory effort, SpO2 <92% despite oxygen.', 'Emergency'],
    ['Discharge and preventer therapy?', 'Review inhaler technique, spacer, written plan, preventer inhaled corticosteroid if indicated, follow-up, avoid triggers.', 'Follow-up'],
    ['Common triggers to ask about?', 'Viral URTI, exercise, allergens, smoke, cold air, NSAIDs, poor adherence, and incorrect device technique.', 'History'],
  ]),
  ...setQuestions('q_fs', 'case_febrile_seizure', [
    ['What is the most likely diagnosis?', 'Simple febrile seizure, provided it was brief, generalized, and occurred with fever in a developmentally normal child aged 6 months to 5 years.', 'Diagnosis'],
    ['How do you distinguish simple from complex febrile seizures?', 'Complex: focal, prolonged (>15 minutes), or recurrent within 24 hours.', 'Diagnosis'],
    ['Do all children need lumbar puncture?', 'No. LP is considered if meningitis/encephalitis cannot be excluded, especially in infants, after complex seizures, or if the child remains unwell.', 'Investigation'],
    ['What parental advice is essential?', 'Most are benign, recurrence is possible, first aid for seizures, when to seek emergency care, and that antipyretics treat comfort not seizure prevention.', 'Follow-up'],
    ['Differential diagnosis?', 'Meningitis/encephalitis, epilepsy, electrolyte disturbance, breath-holding, and non-febrile first seizure.', 'Differential Diagnosis'],
  ]),
  ...setQuestions('q_dka', 'case_dka', [
    ['What is the most likely diagnosis?', 'Diabetic ketoacidosis.', 'Diagnosis'],
    ['Diagnostic criteria?', 'Hyperglycemia, ketonaemia/ketonuria, and metabolic acidosis (low bicarbonate / low pH).', 'Diagnosis'],
    ['Immediate management priorities?', 'ABC, fluid resuscitation according to protocol, insulin infusion after initial fluids, potassium replacement, and search for precipitant. Avoid over-rapid correction.', 'Management'],
    ['What complication of treatment must you watch for?', 'Cerebral edema — headache, drop in consciousness, bradycardia, after treatment starts.', 'Complications'],
    ['Precipitating causes to ask about?', 'Infection, missed insulin, new diagnosis of diabetes, ischemia, drugs.', 'History'],
    ['Key investigations?', 'VBG/ABG, glucose, ketones, U&E, CBC, infection screen, ECG if indicated.', 'Investigation'],
  ]),
  ...setQuestions('q_hf', 'case_hf', [
    ['What is the most likely diagnosis?', 'Acute decompensated heart failure.', 'Diagnosis'],
    ['Important history points?', 'Orthopnea, PND, previous MI, ischemia, drugs (NSAIDs, compliance with diuretics), salt intake, and infective symptoms.', 'History'],
    ['Examination signs of congestion and hypoperfusion?', 'Raised JVP, crackles, edema, S3; cool peripheries, hypotension, oliguria if low output.', 'Examination'],
    ['Initial investigations?', 'ECG, chest X-ray, BNP/NT-proBNP, troponin, U&E, CBC, echo when available.', 'Investigation'],
    ['Acute management outline?', 'Sit up, oxygen, diuretics, treat ischemia/arrhythmia, vasodilators if hypertensive, and inotropes only if shocked.', 'Management'],
  ]),
  ...setQuestions('q_acs', 'case_acs', [
    ['What is the most likely diagnosis?', 'Acute coronary syndrome — treat as STEMI until the ECG is seen.', 'Diagnosis'],
    ['Immediate steps on arrival?', 'ABC, aspirin 300 mg chewed, ECG within 10 minutes, analgesia, oxygen only if hypoxic, dual antiplatelet and reperfusion pathway.', 'Emergency'],
    ['STEMI versus NSTE-ACS?', 'STEMI: ST elevation or new LBBB → immediate reperfusion. NSTE-ACS: risk-stratify, anti-ischemic and antithrombotic therapy, angiography timing by risk.', 'Interpretation'],
    ['Complications of MI?', 'Arrhythmia, heart failure, cardiogenic shock, mechanical complications, Dressler later.', 'Complications'],
    ['Risk factors to cover in history?', 'Smoking, diabetes, hypertension, lipids, family history, previous CAD, cocaine.', 'History'],
  ]),
  ...setQuestions('q_ap', 'case_appendicitis', [
    ['What is the most likely diagnosis?', 'Acute appendicitis.', 'Diagnosis'],
    ['Classic history?', 'Periumbilical pain migrating to RIF, anorexia, nausea, low-grade fever.', 'History'],
    ['Examination signs?', 'RIF tenderness, rebound, guarding, Rovsing, psoas/obturator if relevant. PR not routine in children.', 'Examination'],
    ['Differential diagnosis?', 'Mesenteric adenitis, ovarian torsion/ectopic in females, UTI, gastroenteritis, Meckel, Yersinia, testicular torsion.', 'Differential Diagnosis'],
    ['Management?', 'NBM, IV fluids, analgesia, antibiotics according to protocol, and appendicectomy (laparoscopic where available).', 'Management'],
    ['Complications?', 'Perforation, abscess, peritonitis, pelvic collection, infertility after pelvic sepsis (discuss carefully as educational, not a care plan).', 'Complications'],
  ]),
  ...setQuestions('q_aa', 'case_acute_abdomen', [
    ['What is your working diagnosis?', 'Perforated viscus (e.g. perforated peptic ulcer) causing peritonitis.', 'Diagnosis'],
    ['Immediate management?', 'ABC, oxygen, two large-bore IV lines, fluids, analgesia, NBM, broad-spectrum antibiotics, NG tube, urgent surgical review, and erect CXR looking for free air.', 'Emergency'],
    ['Differential of sudden severe abdominal pain?', 'Perforation, pancreatitis, ruptured AAA, mesenteric ischemia, ruptured ectopic in women, MI, renal colic.', 'Differential Diagnosis'],
    ['What investigation is most useful first?', 'Erect chest X-ray for pneumoperitoneum; amylase/lipase; lactate; CBC; U&E; pregnancy test in women of childbearing age.', 'Investigation'],
  ]),
  ...setQuestions('q_om', 'case_otitis', [
    ['Most likely diagnosis?', 'Acute otitis media.', 'Diagnosis'],
    ['Typical otoscopy findings?', 'Bulging, erythematous tympanic membrane, loss of landmarks, possible perforation with discharge.', 'Examination'],
    ['When are antibiotics indicated?', 'Age under 6 months, severe or bilateral disease, otorrhea, or no improvement after watchful waiting in older children — follow local protocol.', 'Management'],
    ['Complications?', 'Mastoiditis, hearing loss, facial nerve palsy, intracranial extension (rare).', 'Complications'],
  ]),
  ...setQuestions('q_re', 'case_red_eye', [
    ['Dangerous causes of painful red eye?', 'Acute angle-closure glaucoma, keratitis/corneal ulcer, anterior uveitis, scleritis, penetrating injury, endophthalmitis, and gonococcal conjunctivitis in neonates.', 'Differential Diagnosis'],
    ['What must you not miss in history?', 'Contact lens wear, trauma, chemical exposure, severe pain, vision loss, photophobia, haloes, and contact with red-eye cases.', 'History'],
    ['Red flags requiring same-day ophthalmology?', 'Reduced visual acuity, photophobia, irregular pupil, corneal opacity, severe pain, or contact-lens related infection.', 'Emergency'],
    ['How does conjunctivitis typically differ?', 'Usually bilateral or sequential, discharge, normal visual acuity, and little true photophobia.', 'Diagnosis'],
  ]),
  ...setQuestions('q_ec', 'case_eclampsia', [
    ['What is the working diagnosis?', 'Severe pre-eclampsia; eclampsia if a seizure occurs.', 'Diagnosis'],
    ['Immediate management priorities?', 'ABC, control blood pressure, prevent seizures with magnesium sulfate, fluid restriction, steroids for fetal lung maturity if preterm, and plan delivery after maternal stabilization.', 'Emergency'],
    ['Danger symptoms to ask?', 'Headache, visual disturbance, epigastric/RUQ pain, swelling, reduced fetal movements, and vaginal bleeding.', 'History'],
    ['Investigations?', 'CBC (platelets), liver enzymes, creatinine, urine protein, coagulation, CTG, and ultrasound as appropriate.', 'Investigation'],
    ['Magnesium toxicity signs?', 'Loss of tendon reflexes, respiratory depression, oliguria — treat with calcium gluconate.', 'Pharmacology'],
  ]),
  ...setQuestions('q_pph', 'case_pph', [
    ['Define primary PPH.', 'Blood loss ≥500 mL after vaginal birth or ≥1000 mL after cesarean, or any amount causing hemodynamic compromise, within 24 hours of birth.', 'Diagnosis'],
    ['The four T causes?', 'Tone (atony), Trauma (lacerations, inversion), Tissue (retained placenta), Thrombin (coagulopathy).', 'Diagnosis'],
    ['First steps in management?', 'Call for help, uterine massage, uterotonics (oxytocin), IV access, fluids/blood, empty bladder, inspect for trauma/retained tissue, and activate massive hemorrhage protocol if needed.', 'Emergency'],
    ['Medical uterotonics?', 'Oxytocin, ergometrine (avoid in hypertension), misoprostol, carboprost (avoid in asthma).', 'Pharmacology'],
    ['If medical treatment fails?', 'Balloon tamponade, surgical ligation, compression sutures, hysterectomy as last resort, and interventional radiology where available.', 'Management'],
  ]),
];

export const questions: Question[] = [...nephroticQuestions, ...otherQuestions];

interface LinkSpec {
  examinerId: string;
  caseId: string;
  questionPrefix: string;
  times: number;
  years: number[];
}

const links: LinkSpec[] = [
  { examinerId: 'ex_ahmed_peds', caseId: 'case_nephrotic', questionPrefix: 'q_ns_', times: 8, years: [2023, 2024, 2025] },
  { examinerId: 'ex_ahmed_peds', caseId: 'case_bronchiolitis', questionPrefix: 'q_br_', times: 5, years: [2024, 2025] },
  { examinerId: 'ex_ahmed_peds', caseId: 'case_rheumatic', questionPrefix: 'q_rf_', times: 4, years: [2023, 2025] },
  { examinerId: 'ex_hassan_peds', caseId: 'case_asthma', questionPrefix: 'q_as_', times: 5, years: [2024, 2025] },
  { examinerId: 'ex_hassan_peds', caseId: 'case_febrile_seizure', questionPrefix: 'q_fs_', times: 4, years: [2025] },
  { examinerId: 'ex_layla_med', caseId: 'case_dka', questionPrefix: 'q_dka_', times: 6, years: [2024, 2025] },
  { examinerId: 'ex_layla_med', caseId: 'case_hf', questionPrefix: 'q_hf_', times: 3, years: [2025] },
  { examinerId: 'ex_omar_med', caseId: 'case_acs', questionPrefix: 'q_acs_', times: 5, years: [2025] },
  { examinerId: 'ex_omar_med', caseId: 'case_hf', questionPrefix: 'q_hf_', times: 2, years: [2024] },
  { examinerId: 'ex_karim_surg', caseId: 'case_appendicitis', questionPrefix: 'q_ap_', times: 6, years: [2023, 2025] },
  { examinerId: 'ex_karim_surg', caseId: 'case_acute_abdomen', questionPrefix: 'q_aa_', times: 3, years: [2025] },
  { examinerId: 'ex_nour_surg', caseId: 'case_acute_abdomen', questionPrefix: 'q_aa_', times: 4, years: [2025] },
  { examinerId: 'ex_zainab_minor', caseId: 'case_otitis', questionPrefix: 'q_om_', times: 4, years: [2025] },
  { examinerId: 'ex_mustafa_minor', caseId: 'case_red_eye', questionPrefix: 'q_re_', times: 4, years: [2024, 2025] },
  { examinerId: 'ex_fatima_obgyn', caseId: 'case_eclampsia', questionPrefix: 'q_ec_', times: 6, years: [2024, 2025] },
  { examinerId: 'ex_samir_obgyn', caseId: 'case_pph', questionPrefix: 'q_pph_', times: 5, years: [2025] },
];

function questionsForPrefix(prefix: string): Question[] {
  return questions.filter((question) => question.id.startsWith(prefix));
}

export const examinerQuestions: ExaminerQuestion[] = links.flatMap((link) => {
  const caseQuestions = questionsForPrefix(link.questionPrefix);
  const maxTimes = Math.max(...links.map((l) => l.times));
  return caseQuestions.map((question, index) => {
    const timesObserved = Math.max(1, link.times - Math.floor(index / 3));
    return {
      id: `eq_${link.examinerId}_${question.id}`,
      examinerId: link.examinerId,
      questionId: question.id,
      caseId: link.caseId,
      timesObserved,
      yearsObserved: link.years,
      lastObserved: Math.max(...link.years),
      sourceReferences: ['seed-sample'],
      frequencyScore: timesObserved / maxTimes,
    };
  });
});

export const occurrences: QuestionOccurrence[] = examinerQuestions.map((eq) => ({
  id: `occ_${eq.id}`,
  examinerId: eq.examinerId,
  questionId: eq.questionId,
  year: eq.lastObserved,
  sourceDocumentId: 'seed-sample',
  sourceText: SAMPLE_BANNER,
  confidence: 1,
}));

export function examinerCaseIds(examinerId: string): string[] {
  return [...new Set(examinerQuestions.filter((eq) => eq.examinerId === examinerId).map((eq) => eq.caseId))];
}

export function examinersForSpecialty(specialtyId: SpecialtyId): Examiner[] {
  return examiners.filter((examiner) => examiner.departmentId === specialtyId && examiner.active);
}
