import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  BenchmarkFilter,
  ComparisonService,
  HardwareFilter,
} from './comparison.service';

const ALLOWED_BENCHMARKS: BenchmarkFilter[] = ['mlperf', 'mmlu', 'all'];
const ALLOWED_HARDWARE: HardwareFilter[] = ['gpu', 'npu', 'all'];

function parseFilters(
  benchmark?: string,
  hardware?: string,
  node?: string,
  limit?: string,
): {
  benchmarkFilter: BenchmarkFilter;
  hardwareFilter: HardwareFilter;
  nodeFilter: string | null;
  limitNum: number | undefined;
} {
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

  let limitNum: number | undefined;
  if (limit != null && limit !== '') {
    const n = Number.parseInt(limit, 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestException(
        `Query param "limit" must be a positive integer (got "${limit}")`,
      );
    }
    limitNum = n;
  }

  return {
    benchmarkFilter,
    hardwareFilter,
    nodeFilter: node && node.length > 0 ? node : null,
    limitNum,
  };
}

@Controller('comparison')
export class ComparisonController {
  constructor(private readonly comparisonService: ComparisonService) {}

  @Get('list')
  list(
    @Query('benchmark') benchmark?: string,
    @Query('hardware') hardware?: string,
    @Query('node') node?: string,
    @Query('limit') limit?: string,
  ) {
    const { benchmarkFilter, hardwareFilter, nodeFilter, limitNum } =
      parseFilters(benchmark, hardware, node, limit);

    return this.comparisonService.list({
      benchmark: benchmarkFilter,
      hardware: hardwareFilter,
      node: nodeFilter,
      limit: limitNum,
    });
  }

  @Get('export.csv')
  async exportCsv(
    @Query('benchmark') benchmark?: string,
    @Query('hardware') hardware?: string,
    @Query('node') node?: string,
    @Query('limit') limit?: string,
    @Res() res?: Response,
  ) {
    const { benchmarkFilter, hardwareFilter, nodeFilter, limitNum } =
      parseFilters(benchmark, hardware, node, limit);

    const rows = await this.comparisonService.exportRows({
      benchmark: benchmarkFilter,
      hardware: hardwareFilter,
      node: nodeFilter,
      limit: limitNum,
    });

    const csv = this.comparisonService.rowsToCsv(rows);

    if (res) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="comparison.csv"',
      );
      res.send(csv);
      return;
    }
    return csv;
  }

  @Get('export.json')
  async exportJson(
    @Query('benchmark') benchmark?: string,
    @Query('hardware') hardware?: string,
    @Query('node') node?: string,
    @Query('limit') limit?: string,
  ) {
    const { benchmarkFilter, hardwareFilter, nodeFilter, limitNum } =
      parseFilters(benchmark, hardware, node, limit);

    const rows = await this.comparisonService.exportRows({
      benchmark: benchmarkFilter,
      hardware: hardwareFilter,
      node: nodeFilter,
      limit: limitNum,
    });

    return { total: rows.length, runs: rows };
  }

  @Get('diagnostics')
  diagnostics() {
    return this.comparisonService.diagnostics();
  }

  @Get('candidates')
  candidates(
    @Query('runId') runId?: string,
    @Query('benchmark') benchmark?: string,
    @Query('hardware') hardware?: string,
    @Query('tt100tComparable') tt100tComparable?: string,
  ) {
    if (runId == null || runId === '') {
      throw new BadRequestException(
        'Query param "runId" is required for /comparison/candidates',
      );
    }
    const id = Number.parseInt(runId, 10);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException(
        `Query param "runId" must be a positive integer (got "${runId}")`,
      );
    }

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

    // tt100tComparable defaults to true unless explicitly "false"
    const tt100tFlag = tt100tComparable !== 'false';

    return this.comparisonService.findCandidates(id, {
      benchmark: benchmarkFilter,
      hardware: hardwareFilter,
      tt100tComparable: tt100tFlag,
    });
  }

  @Get(':benchmark/:idA/:idB')
  pair(
    @Param('benchmark') benchmark: string,
    @Param('idA') idA: string,
    @Param('idB') idB: string,
  ) {
    if (benchmark !== 'mlperf' && benchmark !== 'mmlu') {
      throw new BadRequestException(
        `Invalid benchmark '${benchmark}'. Allowed: mlperf, mmlu`,
      );
    }
    // C1: ids may be bare numeric ("178") or namespaced "${kind}:${id}"
    // ("npu:178"/"mp:178"/"mm:153") so the service can disambiguate runs that
    // collide across the per-table autoincrement sequences. Validate the
    // shape here (NaN/garbage → 400) and let the service resolve the table.
    const validRunRef = (ref: string): boolean => {
      const m = /^(?:(mp|mm|npu)(?:_exam)?:)?(\d+)$/i.exec(ref.trim());
      return !!m && Number.isFinite(Number.parseInt(m[2], 10));
    };
    if (!validRunRef(idA)) {
      throw new BadRequestException(
        `Invalid run id "${idA}". Expected a numeric id or "<mp|mm|npu>:<id>".`,
      );
    }
    if (!validRunRef(idB)) {
      throw new BadRequestException(
        `Invalid run id "${idB}". Expected a numeric id or "<mp|mm|npu>:<id>".`,
      );
    }
    return this.comparisonService.pair(benchmark, idA, idB);
  }
}
