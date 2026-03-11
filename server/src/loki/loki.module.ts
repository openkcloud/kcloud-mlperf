import { Module } from '@nestjs/common';
import { LokiService } from './loki.service';
import { LokiController } from './loki.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [LokiService],
  controllers: [LokiController],
  exports: [LokiService],
})
export class LokiModule {}
