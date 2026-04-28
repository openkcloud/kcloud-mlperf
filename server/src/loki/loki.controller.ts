import { BadRequestException, Controller, Get, ParseIntPipe, Param } from '@nestjs/common';
import { LokiService } from './loki.service';

const ALLOWED_BENCHMARKS = ['mmlu', 'mlperf'] as const;
type AllowedBenchmark = typeof ALLOWED_BENCHMARKS[number];

@Controller('loki')
export class LokiController {
  constructor(private readonly loki: LokiService) {}

  // GET /loki/instant/:benchmark/:id where :benchmark is mmlu|mlperf.
  // Enum-validates :benchmark to prevent LogQL label-selector injection
  // (LogQL string is interpolated in loki.service.ts).
  @Get('instant/:benchmark/:id')
  async instant(
    @Param('benchmark') benchmark: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (!ALLOWED_BENCHMARKS.includes(benchmark as AllowedBenchmark)) {
      throw new BadRequestException(
        `Invalid benchmark '${benchmark}'. Allowed: ${ALLOWED_BENCHMARKS.join(', ')}`,
      );
    }
    return await this.loki.instantQuery({
      benchmark: benchmark as AllowedBenchmark,
      id,
    });
  }
}
