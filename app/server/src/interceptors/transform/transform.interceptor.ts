import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ResponseFormat<T> {
  code: number;
  status: boolean;
  message: string;
  data: T;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ResponseFormat<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseFormat<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const { method, url } = request;

    return next.handle().pipe(
      map((data) => {
        const statusCode = response.statusCode;

        return {
          code: statusCode,
          status: Boolean(statusCode >= 200 && statusCode < 300),
          message: `${method} ${url} completed successfully`,
          data,
        };
      }),
    );
  }
}
