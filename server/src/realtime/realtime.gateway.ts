import { Injectable, Logger, Optional } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

/**
 * RealtimeGateway owns the 2s broadcast loop and back-pressure logic.
 * RealtimeController uses this gateway to serve SSE connections.
 * RealtimeService is optional so the gateway can be unit-tested standalone.
 */
@Injectable()
export class RealtimeGateway {
  private readonly logger = new Logger(RealtimeGateway.name);
  private _subscriberCount = 0;
  private lastEmitAt = 0;

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
