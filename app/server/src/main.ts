import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { TransformInterceptor } from './interceptors/transform/transform.interceptor';
import { HttpExceptionFilter } from './filters/http-exception/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // M4 — CORS hardening. The frontend is served same-origin (nginx proxies
  // /api to this backend on the same host), so the browser never issues a
  // cross-origin request on the happy path; restricting the allowlist below
  // therefore does NOT break the deployed UI. Origins can be overridden via
  // CORS_ALLOWED_ORIGINS (comma-separated) for other lab hosts.
  //
  // NOTE (intentional): this is an internal-only lab platform reachable solely
  // over the cluster LAN via NodePort, so NO authentication/guards are added
  // here by design. The trust boundary is the network (NetworkPolicy / LAN),
  // not request-level auth. Do not add auth without revisiting that posture.
  const defaultOrigins = [
    'http://10.254.202.81:30001',
    'http://localhost:30001',
    'http://localhost:5173',
  ];
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : defaultOrigins,
    // Only the HTTP verbs the API actually serves (GET/POST/PATCH/DELETE)
    // plus the CORS preflight OPTIONS.
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    // No cookies/Authorization are used (no auth); keep credentials off so the
    // origin allowlist stays strict and the browser does not attach credentials.
    credentials: false,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      /**
       * true - It takes only necessary request body that is showed in dto file types (no any error)
       * false - It takes all request body which is sent by a client (no any restriction)
       * */
      whitelist: true,
      /**
       * true - it takes only validated request body which is specified in dto file (return an erorr)
       * false - default value
       */
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
