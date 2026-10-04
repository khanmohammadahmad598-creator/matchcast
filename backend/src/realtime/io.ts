import { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { isRedisAvailable, redis } from '../core/redis';
import { EV, ROOMS, type ClientToServerEvents, type ServerToClientEvents, type WorkerCommand, type WorkerName } from '@matchcast/shared';

export let io: Server<ClientToServerEvents, ServerToClientEvents>;

const WORKER_ROOM: Record<string, string> = {
  'stream-worker': ROOMS.STREAM_WORKER,
  'graphics-worker': ROOMS.GRAPHICS_WORKER,
  broadcast: ROOMS.DASHBOARD,
};

/**
 * Installs the Socket.IO Redis so several backend replicas can share rooms.
 * The duplicated clients are explicitly connected and we only swap the adapter
 * in once both are ready - otherwise every broadcast would reject while Redis
 * is still warming up.
 */
async function setupRedisAdapter(): Promise<void> {
  try {
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const base = redis();
    if (!base) return;

    const pub = base.duplicate({ lazyConnect: false });
    const sub = base.duplicate({ lazyConnect: false });
    pub.on('error', (err: Error) => logger.warn('backend', 'Redis pub client error', { error: err.message }));
    sub.on('error', (err: Error) => logger.warn('backend', 'Redis sub client error', { error: err.message }));

    await Promise.all([
      pub.status === 'ready' ? Promise.resolve() : new Promise<void>((r) => pub.once('ready', () => r())),
      sub.status === 'ready' ? Promise.resolve() : new Promise<void>((r) => sub.once('ready', () => r())),
    ]);

    io.adapter(createAdapter(pub, sub));
    logger.info('backend', 'Socket.IO Redis adapter enabled');
  } catch (err) {
    logger.warn('backend', 'Redis adapter unavailable - running single-node', { error: (err as Error).message });
  }
}

export function initRealtime(httpServer: HttpServer): Server<ClientToServerEvents, ServerToClientEvents> {
  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: config.ALLOW_ANY_ORIGIN ? true : config.corsOrigins,
      credentials: true,
    },
    maxHttpBufferSize: 1e6,
    pingInterval: 10_000,
    pingTimeout: 20_000,
  });

  // Horizontal scale-out when Redis is present.
  if (isRedisAvailable()) {
    void setupRedisAdapter();
  }

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers?.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');

    // Workers authenticate with the shared WORKER_TOKEN.
    if (token && token === config.WORKER_TOKEN) {
      socket.data.isWorker = true;
      socket.data.workerName = (socket.handshake.auth?.name as WorkerName) ?? 'broadcast';
      return next();
    }
    if (token) {
      try {
        const payload = jwt.verify(token, config.JWT_SECRET) as { sub: string; role: string; email: string };
        socket.data.user = { id: payload.sub, role: payload.role, email: payload.email };
        return next();
      } catch {
        return next(new Error('unauthorized'));
      }
    }
    // Anonymous viewers are allowed read-only access to public score events.
    socket.data.anonymous = true;
    next();
  });

  io.on('connection', (socket) => {
    if (socket.data.isWorker) {
      const name = socket.data.workerName as WorkerName;
      socket.join(WORKER_ROOM[name] ?? ROOMS.DASHBOARD);
      socket.join(ROOMS.DASHBOARD);
      logger.info('backend', `Worker connected: ${name}`, { socketId: socket.id });
    } else if (socket.data.user) {
      socket.join(ROOMS.DASHBOARD);
      if (socket.data.user.role === 'ADMIN') socket.join(ROOMS.ADMINS);
    } else {
      socket.join(ROOMS.DASHBOARD);
    }

    socket.on('subscribe', ({ rooms }) => {
      for (const r of rooms ?? []) {
        if (r === 'dashboard' || r.startsWith('worker:')) socket.join(r);
      }
    });

    socket.on(EV.WORKER_STATUS, (status) => {
      if (!socket.data.isWorker) return;
      // Lazy require keeps io.ts free of a circular dependency on the services.
      void import('../services/streamService')
        .then((m) => m.updateWorkerStatus({ ...status, updatedAt: new Date().toISOString() }))
        .catch(() => undefined);
    });

    socket.on(EV.WORKER_LOG, (entry) => {
      if (!socket.data.isWorker) return;
      // re-emit worker logs to dashboards (already redacted worker-side)
      io.to(ROOMS.DASHBOARD).emit(EV.LOG, entry);
    });
  });

  return io;
}

/* ------------------------------------------------------------------ */
/* Emit helpers used by every service                                  */
/* ------------------------------------------------------------------ */

export const realtime = {
  score(snapshot: unknown) {
    io?.to(ROOMS.DASHBOARD).emit(EV.SCORE_UPDATE, snapshot as never);
  },
  matchEvent(event: unknown) {
    io?.to(ROOMS.DASHBOARD).emit(EV.MATCH_EVENT, event as never);
  },
  commentary(item: unknown) {
    io?.to(ROOMS.DASHBOARD).emit(EV.COMMENTARY_NEW, item as never);
  },
  graphics(settings: unknown) {
    io?.to(ROOMS.DASHBOARD).emit(EV.GRAPHICS_UPDATE, settings as never);
  },
  streamStatus(status: unknown) {
    io?.to(ROOMS.DASHBOARD).emit(EV.STREAM_STATUS, status as never);
  },
  inputStatus(status: unknown) {
    io?.to(ROOMS.DASHBOARD).emit(EV.INPUT_STATUS, status as never);
  },
  systemStats(stats: unknown) {
    io?.to(ROOMS.DASHBOARD).emit(EV.SYSTEM_STATS, stats as never);
  },
  log(entry: unknown) {
    io?.to(ROOMS.DASHBOARD).emit(EV.LOG, entry as never);
  },
  replayClip(clip: unknown) {
    io?.to(ROOMS.DASHBOARD).emit(EV.REPLAY_CLIP, clip as never);
  },
  workerStatus(status: unknown) {
    io?.to(ROOMS.DASHBOARD).emit(EV.WORKER_STATUS, status as never);
  },
  /** Send a command to one worker (or all of them). */
  command(target: WorkerName, cmd: WorkerCommand) {
    if (!io) return false;
    const room = WORKER_ROOM[target];
    const inRoom = io.sockets.adapter.rooms.get(room);
    if (!inRoom || inRoom.size === 0) return false;
    io.to(room).emit(EV.WORKER_COMMAND, cmd);
    return true;
  },
  isWorkerOnline(target: WorkerName): boolean {
    if (!io) return false;
    const room = WORKER_ROOM[target];
    return (io.sockets.adapter.rooms.get(room)?.size ?? 0) > 0;
  },
};
