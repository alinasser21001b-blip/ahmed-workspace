import { errorEnvelopeSchema, fileRefSchema, MAX_IMAGE_BYTES, uuidSchema } from '@sos/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../platform/errors.js';
import * as service from './files.service.js';
import { verifyMediaSignature } from './signed-url.js';

/**
 * File HTTP surface.
 */
export const filesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/files',
    {
      onRequest: [app.requireAuth],
      // Uploads are far more expensive than reads, and are the obvious way to
      // fill a disk. They get their own budget.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['files'],
        summary: 'Upload an image',
        consumes: ['multipart/form-data'],
        response: {
          201: fileRefSchema,
          413: errorEnvelopeSchema,
          415: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const part = await request.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
      if (!part) {
        throw errors.validation([{ path: 'file', message: 'No file was uploaded.' }]);
      }

      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch {
        // @fastify/multipart raises when the declared limit is exceeded mid-stream.
        throw errors.payloadTooLarge(MAX_IMAGE_BYTES);
      }
      if (part.file.truncated) throw errors.payloadTooLarge(MAX_IMAGE_BYTES);

      const uploaded = await service.uploadImage(request.actor!, {
        buffer,
        originalName: part.filename ?? null,
        declaredMime: part.mimetype,
      });
      return reply.status(201).send(uploaded);
    },
  );

  /**
   * Serves bytes for a signed URL.
   *
   * Deliberately unauthenticated: an `<Image src>` cannot send an Authorization
   * header. The signature IS the credential, and it was minted only after a
   * policy check. See `signed-url.ts` for why that is an acceptable trade and
   * where its limits are.
   */
  app.get(
    '/files/:fileId/raw',
    {
      schema: {
        tags: ['files'],
        summary: 'Fetch file bytes using a signed URL',
        params: z.object({ fileId: uuidSchema }),
        querystring: z.object({ exp: z.string(), sig: z.string().max(200) }),
      },
    },
    async (request, reply) => {
      const { fileId } = request.params;
      const { exp, sig } = request.query;

      if (!verifyMediaSignature(fileId, exp, sig)) {
        // 404, not 403: a bad signature must not confirm that the id exists.
        throw errors.notFound('file');
      }

      const file = await service.readFileBytes(fileId);
      return reply
        .header('content-type', file.mimeType)
        .header('content-length', file.sizeBytes)
        // Private media: cacheable by the client for the life of the signature,
        // never by a shared proxy.
        .header('cache-control', 'private, max-age=300')
        .header('x-content-type-options', 'nosniff')
        .send(file.body);
    },
  );

  app.get(
    '/files/:fileId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['files'],
        summary: 'Mint a fresh signed URL for a file',
        params: z.object({ fileId: uuidSchema }),
        response: { 200: fileRefSchema, 404: errorEnvelopeSchema },
      },
    },
    async (request) => service.mintSignedUrl(request.actor!, request.params.fileId),
  );

  app.delete(
    '/files/:fileId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['files'],
        summary: 'Delete an own file',
        params: z.object({ fileId: uuidSchema }),
        response: { 204: z.null(), 404: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      await service.deleteOwnFile(request.actor!, request.params.fileId);
      return reply.status(204).send(null);
    },
  );
};
