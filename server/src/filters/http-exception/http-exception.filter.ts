import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import { Response } from 'express';
import { RpcException } from '@nestjs/microservices';

@Catch()
export class HttpExceptionFilter<T> implements ExceptionFilter {
  catch(exception: T, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        message =
          (exceptionResponse as any).message ||
          (exceptionResponse as any).error ||
          message;
      }
    }

    if (exception instanceof RpcException) {
      message = exception.message;
    }

    response.status(status).json({
      code: status,
      status: false,
      message: Array.isArray(message) ? message.join(', ') : message,
      data: null,
    });
  }
}
