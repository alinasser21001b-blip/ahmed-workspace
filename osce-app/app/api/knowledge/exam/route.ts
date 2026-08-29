import { DB, ensureKnowledgeSchema } from '@/lib/knowledge/db';
import { logOperationalError } from '@/lib/operations';

type KnowledgeRow = { examinerId:string; examinerName:string; caseId:string; caseTitle:string; scenario:string|null; questionId:string; prompt:string; category:string; evaluationReady:number };
type Question = { id:string; prompt:string; category:string; evaluationReady:boolean };
type CaseStudy = { id:string; title:string; scenario:string; questions:Question[] };
type Examiner = { id:string; name:string; cases:CaseStudy[]; questions:number };

export async function GET(request: Request) {
  try {
    await ensureKnowledgeSchema(); const specialtyId = new URL(request.url).searchParams.get('specialtyId'); if (!specialtyId) return Response.json({ error: 'SPECIALTY_REQUIRED' }, { status: 400 });
    const { results } = await DB.prepare(`SELECT e.id AS examinerId, e.canonical_name AS examinerName, c.id AS caseId, c.canonical_title AS caseTitle, c.clinical_scenario AS scenario, q.id AS questionId, q.canonical_text AS prompt, q.category, CASE WHEN q.answer_approved = 1 AND q.expected_answer IS NOT NULL AND q.expected_answer != '' AND q.key_points_json != '[]' THEN 1 ELSE 0 END AS evaluationReady FROM published_examiners e JOIN examiner_cases ec ON ec.examiner_id = e.id JOIN published_cases c ON c.id = ec.case_id JOIN examiner_questions eq ON eq.examiner_id = e.id AND eq.case_id = c.id JOIN published_questions q ON q.id = eq.question_id WHERE e.specialty_id = ? AND e.active = 1 ORDER BY e.canonical_name, c.canonical_title, q.id`).bind(specialtyId).all<KnowledgeRow>();
    const examiners = new Map<string, Examiner>(); const cases = new Map<string, CaseStudy>();
    for (const row of results) {
      let examiner = examiners.get(row.examinerId); if (!examiner) { examiner = { id:row.examinerId, name:row.examinerName, cases:[], questions:0 }; examiners.set(row.examinerId, examiner); }
      const caseKey = `${row.examinerId}:${row.caseId}`; let caseStudy = cases.get(caseKey); if (!caseStudy) { caseStudy = { id:row.caseId, title:row.caseTitle, scenario:row.scenario ?? `Historical ${row.caseTitle} station. Review the case and discuss it with the examiner.`, questions:[] }; cases.set(caseKey, caseStudy); examiner.cases.push(caseStudy); }
      caseStudy.questions.push({ id:row.questionId, prompt:row.prompt, category:row.category, evaluationReady:Boolean(row.evaluationReady) }); examiner.questions += 1;
    }
    return Response.json([...examiners.values()]);
  } catch (error) { logOperationalError('knowledge.student_read', error); return Response.json({ error: 'PUBLISHED_KNOWLEDGE_UNAVAILABLE' }, { status: 503 }); }
}
