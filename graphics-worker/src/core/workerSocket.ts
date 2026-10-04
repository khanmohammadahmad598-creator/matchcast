import { io as ioClient, type Socket } from 'socket.io-client';
import { config } from './config';
import { logger } from './logger';
import { EV, type WorkerCommand, type WorkerName } from '@matchcast/shared';

type CommandHandler = (cmd: WorkerCommand) => void | Promise<void>;

/** Control-plane socket for the graphics worker (auto-reconnecting). */
export class WorkerSocket {
  private socket: Socket | null = null;
  private handlers: CommandHandler[] = [];
  private pendingEvents: Array<{ event: string; handler: (payload: never) => void }> = [];

  constructor(private name: WorkerName, private getStatusPayload: () => Record<string, unknown>) {}

  onCommand(handler: CommandHandler): void {
    this.handlers.push(handler);
  }

  on(event: string, handler: (payload: never) => void): void {
    this.socket?.on(event, handler as (...args: unknown[]) => void);
    this.pendingEvents.push({ event, handler });
  }

  start(): void {
    this.socket = ioClient(config.BACKEND_URL, {
      transports: ['websocket'],
      auth: { token: config.WORKER_TOKEN, name: this.name },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10_000,
    });

    this.socket.on('connect', () => {
      logger.info('system', `Connected to backend control plane (${this.name})`);
      for (const { event, handler } of this.pendingEvents) {
        this.socket?.off(event);
        this.socket?.on(event, handler as (...args: unknown[]) => void);
      }
      this.pushStatus();
    });

    this.socket.on('disconnect', (reason) => {
      logger.warn('system', `Disconnected from backend: ${reason} - overlays continue with last settings`);
    });

    this.socket.on('connect_error', (err) => {
      logger.debug('system', `Backend connection error: ${err.message}`);
    });

    this.socket.on(EV.WORKER_COMMAND, async (cmd: WorkerCommand) => {
      for (const h of this.handlers) {
        try {
          await h(cmd);
        } catch (err) {
          logger.error('system', `Command ${cmd.type} failed`, { error: (err as Error).message });
        }
      }
    });

    setInterval(() => this.pushStatus(), 5000).unref();
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  private pushStatus(): void {
    this.socket?.emit(EV.WORKER_STATUS, {
      name: this.name,
      online: true,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      details: this.getStatusPayload(),
      updatedAt: new Date().toISOString(),
    });
  }
}
