import { ZodError } from 'zod';
import { DomainError } from '@/domain/invariants';

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof DomainError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  if (error instanceof ZodError) {
    return json({ error: 'Invalid request', code: 'VALIDATION', details: error.flatten() }, 400);
  }
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return json({ error: message, code: 'INTERNAL' }, 500);
}
