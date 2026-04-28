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
import { Observable, Subject, interval, from } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { RealtimeService } from './realtime.service';

const MAX_SUBSCRIBERS = 20;
const EMIT_INTERVAL_MS = 2000;

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

    return interval(EMIT_INTERVAL_MS).pipe(
      takeUntil(done$),
      switchMap(() => from(this.realtimeService.buildSnapshot())),
      // NestJS SSE expects Observable<MessageEvent>; wrap snapshot in {data}
      switchMap((snapshot) =>
        from(
          Promise.resolve({ data: snapshot } as unknown as MessageEvent),
        ),
      ),
    );
  }
}
