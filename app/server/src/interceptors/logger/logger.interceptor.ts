import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    console.log(`Request started...`);
    const startDate = Date.now();
    return next.handle().pipe(
      tap((data) => {
        console.log(
          `Request completed in ${Date.now() - startDate} ms data: ${JSON.stringify(data)}`,
        );
      }),
    );
  }
}
