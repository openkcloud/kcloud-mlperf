import { Injectable, Logger, Optional } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

/**
 * RealtimeGateway owns the 2s broadcast loop and back-pressure logic.
 * RealtimeController uses this gateway to serve SSE connections.
 * RealtimeService is optional so the gateway can be unit-tested standalone.
 */
/**
 * Keepalive interval — emit a `: ping\n\n` SSE comment every 15s so idle
 * intermediaries (nginx default 60s, k8s ingress 60s) don't drop the
 * connection between snapshot frames.
 */
export const SSE_KEEPALIVE_MS = 15000;

@Injectable()
export class RealtimeGateway {
  private readonly logger = new Logger(RealtimeGateway.name);
  private _subscriberCount = 0;
  private lastEmitAt = 0;
  private lastKeepaliveAt = 0;

  constructor(@Optional() private readonly realtimeService: RealtimeService | null) {}

  get subscriberCount(): number {
    return this._subscriberCount;
  }

  incrementSubscribers() {
    this._subscriberCount++;
  }

  decrementSubscribers() {
    this._subscriberCount = Math.max(0, this._subscriberCount - 1);
  }

  private async buildMessage() {
    if (!this.realtimeService) {
      return {
        timestamp: new Date().toISOString(),
        slots: [],
        sweep_progress: { completed: 0, total: 0, active_sweep_id: null, paused: false },
        operator_race_alerts: 0,
      };
    }
    return this.realtimeService.buildSnapshot();
  }

  private broadcastSnapshot(message: unknown) {
    this.logger.debug('broadcast: ' + JSON.stringify(message));
  }

  /** True when the gateway should emit a keepalive comment now. */
  shouldEmitKeepalive(now: number = Date.now()): boolean {
    if (this._subscriberCount === 0) return false;
    return now - this.lastKeepaliveAt >= SSE_KEEPALIVE_MS;
  }

  markKeepaliveEmitted(now: number = Date.now()): void {
    this.lastKeepaliveAt = now;
  }

  async tick() {
    if (this._subscriberCount === 0) {
      return;
    }

    const now = Date.now();
    if (now - this.lastEmitAt < 2000) {
      return;
    }

    this.lastEmitAt = now;
    const message = await this.buildMessage();
    this.broadcastSnapshot(message);
  }
}
