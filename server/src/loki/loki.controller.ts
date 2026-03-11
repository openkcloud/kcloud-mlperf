import { Controller, Get, ParseIntPipe, Param } from '@nestjs/common';
import { LokiService } from './loki.service';

@Controller('loki')
export class LokiController {
  constructor(private readonly loki: LokiService) {}

  // GET /loki/instant?query={app="my-app"}
  @Get('instant/:benchmark/:id')
  async instant(
    @Param('benchmark') benchmark: 'mmlu' | 'mlperf',
    @Param('id', ParseIntPipe) id: number,
  ) {
    return await this.loki.instantQuery({ benchmark, id });
  }
}
