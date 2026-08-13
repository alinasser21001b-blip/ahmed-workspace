import { realtimeClientFrameSchema, type RealtimeServerFrame } from '@sos/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { loadActor, findSessionById } from '../auth/auth.repository.js';
import { verifyAccessToken } from '../auth/tokens.js';
import * as service from './conversations.service.js';
import * as repo from './conversations.repository.js';
import * as presence from './presence.repository.js';
import {
  publishToWatchers,
  register,
  subscribe,
  unregister,
  unsubscribe,
  type Connection,
} from './realtime.js';

/**
 * The realtime endpoint.
 *
 * `WS /v1/realtime?token=<accessToken>`.
 *
 * The token travels in the query string because a browser's WebSocket
 * constructor cannot set an `Authorization` header — the one place in this API
 * where that is true. The mitigations are the ones that make it acceptable
 * rather than merely unavoidable: the access token is short-lived (15 minutes),
 * its session is checked against the database on every handshake exactly as it
 * is for REST, and the handshake URL is not a link anyone shares. A dedicated
 * single-use ticket endpoint would be better and is the obvious upgrade; it is
 * not built now because it would be the only asymmetry in the auth model and
 * this token is already the weakest credential in the system.
 *
 * Everything the socket accepts is a *subscription* or an *ephemeral hint*.
 * There is no frame that writes to the database. See `realtime.ts`.
 */

const TYPING_TTL_MS = 5000;

/** Typing state, in memory, expiring on its own. Never persisted. */
const typing = new Map<string, Map<string, NodeJS.Timeout>>();

function send(socket: { send: (data: string) => void }, frame: RealtimeServerFrame): void {
  try {
    socket.send(JSON.stringify(frame));
  } catch {
    /* gone */
  }
}

export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/realtime', { websocket: true }, async (socket, request) => {
    const token = (request.query as { token?: string } | undefined)?.token;

    /*
     * The same authentication the REST layer performs, in the same order:
     * verify the signature, then confirm the session has not been revoked. A
     * socket that skipped the session check would keep a logged-out user
     * connected for up to fifteen minutes, receiving every message.
     */
    const claims = token ? await verifyAccessToken(token) : null;
    if (!claims) {
      send(socket, { type: 'error', code: 'UNAUTHENTICATED', message: 'A valid token is required.' });
      socket.close(1008, 'unauthenticated');
      return;
    }

    const session = await findSessionById(claims.sid);
    if (!session || session.revoked_at !== null || session.expires_at.getTime() <= Date.now()) {
      send(socket, { type: 'error', code: 'UNAUTHENTICATED', message: 'The session has ended.' });
      socket.close(1008, 'unauthenticated');
      return;
    }

    const actor = await loadActor(claims.sub);
    if (!actor || actor.status === 'suspended' || actor.status === 'banned') {
      send(socket, { type: 'error', code: 'FORBIDDEN', message: 'This account cannot connect.' });
      socket.close(1008, 'forbidden');
      return;
    }

    const connection: Connection = register(actor.userId, {
      send: (data) => socket.send(data),
      get closed() {
        return socket.readyState !== socket.OPEN;
      },
    });

    await presence.connect(actor.userId);
    send(socket, { type: 'ready', userId: actor.userId });

    socket.on('message', (raw: Buffer | string) => {
      void (async () => {
        let frame;
        try {
          frame = realtimeClientFrameSchema.parse(JSON.parse(String(raw)));
        } catch {
          send(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'Unrecognised frame.' });
          return;
        }

        switch (frame.type) {
          case 'ping':
            send(socket, { type: 'pong' });
            return;

          case 'subscribe': {
            /*
             * The same gate as the REST read. A subscription can never grant
             * access the HTTP API would refuse, because it asks the same
             * question of the same policy.
             */
            if (!(await service.canSubscribe(actor, frame.conversationId))) {
              send(socket, {
                type: 'error',
                code: 'NOT_FOUND',
                message: 'No such conversation.',
              });
              return;
            }
            subscribe(connection, frame.conversationId);
            const conversation = await repo.findConversationById(
              frame.conversationId,
              actor.userId,
            );
            send(socket, {
              type: 'subscribed',
              conversationId: frame.conversationId,
              lastSeq: Number(conversation?.last_seq ?? 0),
            });
            return;
          }

          case 'unsubscribe':
            unsubscribe(connection, frame.conversationId);
            return;

          case 'resync': {
            /*
             * The reconnect path, and the reason a dropped socket is a latency
             * problem rather than a data-loss one: the client says what it has,
             * and the server sends everything after it, in order.
             */
            const gap = await service.replayGap(actor, frame.conversationId, frame.lastSeq);
            if (!gap) {
              send(socket, { type: 'error', code: 'NOT_FOUND', message: 'No such conversation.' });
              return;
            }
            send(socket, {
              type: 'resync',
              conversationId: frame.conversationId,
              messages: gap.messages,
              lastSeq: gap.lastSeq,
            });
            return;
          }

          case 'typing': {
            if (!connection.subscriptions.has(frame.conversationId)) return;

            /*
             * Ephemeral by construction: a timer clears the state, so a client
             * that disconnects mid-keystroke does not leave a permanent
             * "typing…" behind. Nothing is written to the database — a typing
             * row would be a write per keystroke burst per participant, to
             * record a fact that is false three seconds later.
             */
            const perConversation = typing.get(frame.conversationId) ?? new Map();
            typing.set(frame.conversationId, perConversation);

            const existing = perConversation.get(actor.userId);
            if (existing) clearTimeout(existing);

            const members = await repo.listMemberIds(frame.conversationId);
            const audience = members.filter((id) => id !== actor.userId);

            if (frame.typing) {
              perConversation.set(
                actor.userId,
                setTimeout(() => {
                  perConversation.delete(actor.userId);
                  publishToWatchers(audience, frame.conversationId, {
                    type: 'typing',
                    conversationId: frame.conversationId,
                    userId: actor.userId,
                    typing: false,
                  });
                }, TYPING_TTL_MS),
              );
            } else {
              perConversation.delete(actor.userId);
            }

            publishToWatchers(audience, frame.conversationId, {
              type: 'typing',
              conversationId: frame.conversationId,
              userId: actor.userId,
              typing: frame.typing,
            });
            return;
          }

          default: {
            const never: never = frame;
            void never;
          }
        }
      })();
    });

    socket.on('close', () => {
      unregister(connection);
      // Clear any typing state this connection was holding, so a disconnect
      // mid-keystroke does not leave the indicator up for its full TTL.
      for (const [conversationId, perConversation] of typing) {
        const timer = perConversation.get(actor.userId);
        if (!timer) continue;
        clearTimeout(timer);
        perConversation.delete(actor.userId);
        void repo.listMemberIds(conversationId).then((members) => {
          publishToWatchers(
            members.filter((id) => id !== actor.userId),
            conversationId,
            { type: 'typing', conversationId, userId: actor.userId, typing: false },
          );
        });
      }
      void presence.disconnect(actor.userId);
    });
  });
};
