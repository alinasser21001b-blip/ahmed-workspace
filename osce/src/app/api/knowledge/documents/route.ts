import { ingestUpload } from '@/data/ingest';
import { getStore } from '@/data/store';
import { isSpecialtyId } from '@/domain/models';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = await getStore().read();
  return json({
    documents: store.documents.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      fileType: doc.fileType,
      uploadedAt: doc.uploadedAt,
      processingStatus: doc.processingStatus,
      department: doc.department,
      sourceYear: doc.sourceYear,
      processedAt: doc.processedAt,
      version: doc.version,
      error: doc.error,
    })),
  });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return json({ error: 'file is required', code: 'FILE_REQUIRED' }, 400);
    }
    const departmentRaw = String(form.get('department') ?? '');
    const department = isSpecialtyId(departmentRaw) ? departmentRaw : undefined;
    const yearRaw = form.get('sourceYear');
    const sourceYear = yearRaw ? Number(yearRaw) : undefined;
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await ingestUpload({
      filename: file.name,
      mimeType: file.type,
      buffer,
      department,
      sourceYear: Number.isFinite(sourceYear) ? sourceYear : undefined,
    });
    return json(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
