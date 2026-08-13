import { closePool, queryOne, withTransaction } from '../src/platform/db.js';

/**
 * Development seed: one dense cohort.
 *
 * This mirrors the V1 targeting decision (§3): a single university → college →
 * stage with real courses, subjects and topics, rather than a scatter of
 * unrelated institutions. Feed relevance and group formation are only testable
 * against density.
 *
 * Nothing medical is hardcoded in the schema or the code — this file is the
 * only place "Pediatrics" appears, which is exactly the point (§63).
 */

interface SeedCourse {
  slug: string;
  code: string;
  nameAr: string;
  nameEn: string;
  subjects: { slug: string; nameAr: string; nameEn: string; topics: [string, string, string][] }[];
}

const COURSES: SeedCourse[] = [
  {
    slug: 'pediatrics',
    code: 'PED-501',
    nameAr: 'طب الأطفال',
    nameEn: 'Pediatrics',
    subjects: [
      {
        slug: 'nephrology',
        nameAr: 'أمراض الكلى',
        nameEn: 'Nephrology',
        topics: [
          ['nephrotic-syndrome', 'المتلازمة الكلوية', 'Nephrotic Syndrome'],
          ['acute-glomerulonephritis', 'التهاب الكبيبات الحاد', 'Acute Glomerulonephritis'],
          ['uti-in-children', 'التهاب المجاري البولية', 'UTI in Children'],
        ],
      },
      {
        slug: 'neonatology',
        nameAr: 'طب حديثي الولادة',
        nameEn: 'Neonatology',
        topics: [
          ['neonatal-jaundice', 'اليرقان الوليدي', 'Neonatal Jaundice'],
          ['respiratory-distress', 'الضائقة التنفسية', 'Respiratory Distress Syndrome'],
        ],
      },
    ],
  },
  {
    slug: 'internal-medicine',
    code: 'MED-502',
    nameAr: 'الطب الباطني',
    nameEn: 'Internal Medicine',
    subjects: [
      {
        slug: 'cardiology',
        nameAr: 'أمراض القلب',
        nameEn: 'Cardiology',
        topics: [
          ['heart-failure', 'قصور القلب', 'Heart Failure'],
          ['arrhythmias', 'اضطرابات النظم', 'Arrhythmias'],
        ],
      },
      {
        slug: 'endocrinology',
        nameAr: 'الغدد الصماء',
        nameEn: 'Endocrinology',
        topics: [
          ['diabetes-mellitus', 'الداء السكري', 'Diabetes Mellitus'],
          ['thyroid-disorders', 'اضطرابات الغدة الدرقية', 'Thyroid Disorders'],
        ],
      },
    ],
  },
  {
    slug: 'surgery',
    code: 'SUR-503',
    nameAr: 'الجراحة',
    nameEn: 'Surgery',
    subjects: [
      {
        slug: 'general-surgery',
        nameAr: 'الجراحة العامة',
        nameEn: 'General Surgery',
        topics: [
          ['acute-abdomen', 'البطن الحاد', 'Acute Abdomen'],
          ['hernias', 'الفتوق', 'Hernias'],
        ],
      },
    ],
  },
];

const STAGES: [number, string, string][] = [
  [1, 'المرحلة الأولى', 'Stage 1'],
  [2, 'المرحلة الثانية', 'Stage 2'],
  [3, 'المرحلة الثالثة', 'Stage 3'],
  [4, 'المرحلة الرابعة', 'Stage 4'],
  [5, 'المرحلة الخامسة', 'Stage 5'],
  [6, 'المرحلة السادسة', 'Stage 6'],
];

async function seed(): Promise<void> {
  await withTransaction(async (client) => {
    const university = await queryOne<{ id: string }>(
      `INSERT INTO universities (slug, name_ar, name_en, country, city)
       VALUES ('uob', 'جامعة بغداد', 'University of Baghdad', 'IQ', 'Baghdad')
       ON CONFLICT (slug) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [],
      client,
    );
    const universityId = university!.id;

    const college = await queryOne<{ id: string }>(
      `INSERT INTO colleges (university_id, slug, name_ar, name_en)
       VALUES ($1, 'medicine', 'كلية الطب', 'College of Medicine')
       ON CONFLICT (university_id, slug) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [universityId],
      client,
    );
    const collegeId = college!.id;

    const program = await queryOne<{ id: string }>(
      `INSERT INTO programs (college_id, slug, name_ar, name_en, degree_type, duration_years)
       VALUES ($1, 'mbchb', 'بكالوريوس طب وجراحة', 'MBChB', 'bachelor', 6)
       ON CONFLICT (college_id, slug) DO UPDATE SET name_en = EXCLUDED.name_en
       RETURNING id`,
      [collegeId],
      client,
    );
    const programId = program!.id;

    const stageIds = new Map<number, string>();
    for (const [ordinal, nameAr, nameEn] of STAGES) {
      const stage = await queryOne<{ id: string }>(
        `INSERT INTO stages (program_id, ordinal, name_ar, name_en)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (program_id, ordinal) DO UPDATE SET name_en = EXCLUDED.name_en
         RETURNING id`,
        [programId, ordinal, nameAr, nameEn],
        client,
      );
      stageIds.set(ordinal, stage!.id);
    }

    const academicYear = await queryOne<{ id: string }>(
      `INSERT INTO academic_years (university_id, label, starts_on, ends_on, is_current)
       VALUES ($1, '2025/2026', '2025-10-01', '2026-07-01', true)
       ON CONFLICT (university_id, label) DO UPDATE SET is_current = true
       RETURNING id`,
      [universityId],
      client,
    );

    // The V1 cohort: 5th-year medicine.
    const stage5 = stageIds.get(5)!;

    for (const course of COURSES) {
      const courseRow = await queryOne<{ id: string }>(
        `INSERT INTO courses (program_id, stage_id, academic_year_id, code, slug, name_ar, name_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (program_id, stage_id, slug) DO UPDATE SET name_en = EXCLUDED.name_en
         RETURNING id`,
        [programId, stage5, academicYear!.id, course.code, course.slug, course.nameAr, course.nameEn],
        client,
      );

      for (const [index, subject] of course.subjects.entries()) {
        const subjectRow = await queryOne<{ id: string }>(
          `INSERT INTO subjects (course_id, slug, name_ar, name_en, ordinal)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (course_id, slug) DO UPDATE SET name_en = EXCLUDED.name_en
           RETURNING id`,
          [courseRow!.id, subject.slug, subject.nameAr, subject.nameEn, index],
          client,
        );

        for (const [topicIndex, [slug, nameAr, nameEn]] of subject.topics.entries()) {
          await queryOne(
            `INSERT INTO topics (subject_id, slug, name_ar, name_en, ordinal)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (subject_id, slug) DO UPDATE SET name_en = EXCLUDED.name_en`,
            [subjectRow!.id, slug, nameAr, nameEn, topicIndex],
            client,
          );
        }
      }

      // Each course gets a community, so a student who joins a cohort has
      // somewhere to land immediately rather than an empty app.
      await queryOne(
        `INSERT INTO communities (slug, name_ar, name_en, university_id, college_id,
                                  stage_id, course_id, visibility, is_official)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'stage', true)
         ON CONFLICT (slug) DO NOTHING`,
        [
          `uob-med-s5-${course.slug}`,
          course.nameAr,
          course.nameEn,
          universityId,
          collegeId,
          stage5,
          courseRow!.id,
        ],
        client,
      );
    }
  });
}

seed()
  .then(async () => {
    process.stdout.write('seeded University of Baghdad → College of Medicine → Stage 5\n');
    await closePool();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`seed failed: ${(error as Error).message}\n`);
    await closePool().catch(() => {});
    process.exit(1);
  });
