import {
  Controller,
  Get,
  HttpStatus,
  OnModuleDestroy,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, Subject, interval, from, merge } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';
import { RealtimeService } from './realtime.service';

const MAX_SUBSCRIBERS = 20;
const EMIT_INTERVAL_MS = 2000;
const KEEPALIVE_INTERVAL_MS = 15000;

@Controller('realtime')
export class RealtimeController implements OnModuleDestroy {
  private subscriberCount = 0;

  constructor(private readonly realtimeService: RealtimeService) {}

  onModuleDestroy() {
    // nothing — intervals are scoped per-connection via takeUntil
  }

  @Get('exams/snapshot')
  async getSnapshot() {
    return this.realtimeService.buildSnapshot();
  }

  @Get('exams/health')
  getHealth() {
    return {
      status: 'ok',
      subscribers: this.subscriberCount,
      timestamp: new Date().toISOString(),
    };
  }

  @Sse('exams')
  streamExams(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Observable<MessageEvent> {
    if (this.subscriberCount >= MAX_SUBSCRIBERS) {
      res.setHeader('X-Fallback', 'poll');
      res.status(HttpStatus.SERVICE_UNAVAILABLE).end();
      return new Observable((sub) => sub.complete());
    }

    this.subscriberCount++;

    const done$ = new Subject<void>();

    req.on('close', () => {
      done$.next();
      done$.complete();
      this.subscriberCount--;
    });

    const snapshots$ = interval(EMIT_INTERVAL_MS).pipe(
      switchMap(() => from(this.realtimeService.buildSnapshot())),
      map(
        (snapshot) =>
          ({ type: 'snapshot', data: snapshot }) as unknown as MessageEvent,
      ),
    );

    // Keepalive: emit a `ping` event so idle proxies (nginx/k8s ingress with
    // 60s default) don't sever the connection between snapshots. EventSource
    // ignores unknown event types, so the frontend's 'snapshot' listener is
    // unaffected — but the bytes on the wire reset proxy idle timers.
    const keepalive$ = interval(KEEPALIVE_INTERVAL_MS).pipe(
      map(
        () =>
          ({
            type: 'ping',
            data: { timestamp: new Date().toISOString() },
          }) as unknown as MessageEvent,
      ),
    );

    return merge(snapshots$, keepalive$).pipe(takeUntil(done$));
  }
}
