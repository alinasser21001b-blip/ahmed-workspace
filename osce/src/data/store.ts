import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { SAMPLE_BANNER, cases, examinerQuestions, examiners, occurrences, questions } from './seed';
import type {
  ClinicalCase,
  ExtractionCandidate,
  ExamSession,
  Examiner,
  ExaminerQuestion,
  KnowledgeDocument,
  Question,
  QuestionOccurrence,
} from '../domain/models';

export interface OsceStore {
  examiners: Examiner[];
  cases: ClinicalCase[];
  questions: Question[];
  examinerQuestions: ExaminerQuestion[];
  occurrences: QuestionOccurrence[];
  documents: KnowledgeDocument[];
  candidates: ExtractionCandidate[];
  sessions: ExamSession[];
  seedBanner: string;
}

export function emptySeededStore(): OsceStore {
  return {
    examiners: structuredClone(examiners),
    cases: structuredClone(cases),
    questions: structuredClone(questions),
    examinerQuestions: structuredClone(examinerQuestions),
    occurrences: structuredClone(occurrences),
    documents: [
      {
        id: 'seed-sample',
        filename: 'SAMPLE_DEVELOPMENT_DATA.md',
        fileType: 'markdown',
        uploadedAt: '2026-01-01T00:00:00.000Z',
        processingStatus: 'PROCESSED',
        processedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        originalText: SAMPLE_BANNER,
      },
    ],
    candidates: [],
    sessions: [],
    seedBanner: SAMPLE_BANNER,
  };
}

export interface StoreRepository {
  read(): Promise<OsceStore>;
  write(mutator: (store: OsceStore) => void): Promise<OsceStore>;
}

class Mutex {
  private chain: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export class MemoryStore implements StoreRepository {
  private store: OsceStore;
  private mutex = new Mutex();

  constructor(initial: OsceStore = emptySeededStore()) {
    this.store = structuredClone(initial);
  }

  async read(): Promise<OsceStore> {
    return structuredClone(this.store);
  }

  async write(mutator: (store: OsceStore) => void): Promise<OsceStore> {
    return this.mutex.run(async () => {
      mutator(this.store);
      return structuredClone(this.store);
    });
  }
}

export class FileStore implements StoreRepository {
  private mutex = new Mutex();

  constructor(private readonly filePath: string) {}

  async read(): Promise<OsceStore> {
    return this.mutex.run(async () => this.load());
  }

  async write(mutator: (store: OsceStore) => void): Promise<OsceStore> {
    return this.mutex.run(async () => {
      const store = await this.load();
      mutator(store);
      await this.persist(store);
      return structuredClone(store);
    });
  }

  private async load(): Promise<OsceStore> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as OsceStore;
      if (!parsed.examiners || !parsed.sessions) return emptySeededStore();
      return parsed;
    } catch {
      const seeded = emptySeededStore();
      await this.persist(seeded);
      return seeded;
    }
  }

  private async persist(store: OsceStore): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }
}

const globalForStore = globalThis as unknown as { __osceStore?: StoreRepository };

export function getStore(): StoreRepository {
  if (globalForStore.__osceStore) return globalForStore.__osceStore;
  const filePath = process.env.OSCE_STORE_PATH ?? path.join(process.cwd(), 'data', 'store.json');
  const store = process.env.OSCE_STORE === 'memory' ? new MemoryStore() : new FileStore(filePath);
  globalForStore.__osceStore = store;
  return store;
}

export function knowledgeView(store: OsceStore) {
  return {
    examiners: store.examiners,
    cases: store.cases,
    questions: store.questions,
    examinerQuestions: store.examinerQuestions,
  };
}
