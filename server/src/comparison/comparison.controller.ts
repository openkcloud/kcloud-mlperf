import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import {
  BenchmarkFilter,
  ComparisonService,
  HardwareFilter,
} from './comparison.service';

const ALLOWED_BENCHMARKS: BenchmarkFilter[] = ['mlperf', 'mmlu', 'all'];
const ALLOWED_HARDWARE: HardwareFilter[] = ['gpu', 'npu', 'all'];

@Controller('comparison')
export class ComparisonController {
  constructor(private readonly comparisonService: ComparisonService) {}

  @Get('list')
  list(
    @Query('benchmark') benchmark?: string,
    @Query('hardware') hardware?: string,
    @Query('node') node?: string,
  ) {
    const benchmarkFilter = (benchmark || 'all') as BenchmarkFilter;
    const hardwareFilter = (hardware || 'all') as HardwareFilter;

    if (!ALLOWED_BENCHMARKS.includes(benchmarkFilter)) {
      throw new BadRequestException(
        `Invalid benchmark filter '${benchmark}'. Allowed: ${ALLOWED_BENCHMARKS.join(', ')}`,
      );
    }
    if (!ALLOWED_HARDWARE.includes(hardwareFilter)) {
      throw new BadRequestException(
        `Invalid hardware filter '${hardware}'. Allowed: ${ALLOWED_HARDWARE.join(', ')}`,
      );
    }

    return this.comparisonService.list({
      benchmark: benchmarkFilter,
      hardware: hardwareFilter,
      node: node && node.length > 0 ? node : null,
    });
  }

  @Get('diagnostics')
  diagnostics() {
    return this.comparisonService.diagnostics();
  }

  @Get(':benchmark/:idA/:idB')
  pair(
    @Param('benchmark') benchmark: string,
    @Param('idA', ParseIntPipe) idA: number,
    @Param('idB', ParseIntPipe) idB: number,
  ) {
    if (benchmark !== 'mlperf' && benchmark !== 'mmlu') {
      throw new BadRequestException(
        `Invalid benchmark '${benchmark}'. Allowed: mlperf, mmlu`,
      );
    }
    return this.comparisonService.pair(benchmark, idA, idB);
  }
}
