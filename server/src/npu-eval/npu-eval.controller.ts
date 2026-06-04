import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Body,
  ParseIntPipe,
  Patch,
  Delete,
  Query,
} from '@nestjs/common';
import { NpuEvalService } from './npu-eval.service';
import { CreateNpuExamDto } from './dto/create-npu-exam.dto';
import { UpdateNpuExamDto } from './dto/update-npu-exam.dto';
import { CreateNpuExamResultDto } from './dto/create-npu-exam-result.dto';
import { PaginationQueryDto } from '../common-dto/pagination-query.dto';

const ALLOWED_GPU_BENCHMARKS = ['mlperf', 'mmlu'] as const;
type AllowedGpuBenchmark = (typeof ALLOWED_GPU_BENCHMARKS)[number];

@Controller('npu-eval')
export class NpuEvalController {
  constructor(private readonly npuEvalService: NpuEvalService) {}

  @Get('npu-list')
  getNpuList() {
    return this.npuEvalService.getAvailableNpuList();
  }

  @Get('status/:id')
  getStatus(@Param('id', ParseIntPipe) id: number) {
    return this.npuEvalService.getNpuExamStatus(id);
  }

  @Get('list')
  findAll(@Query() query: PaginationQueryDto) {
    return this.npuEvalService.findAll(query);
  }

  @Get('details/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.npuEvalService.findOne(id);
  }

  @Patch('start-time/:id')
  updateStartTime(@Param('id', ParseIntPipe) id: number) {
    return this.npuEvalService.updateNpuExamStartTime(id);
  }

  @Patch('stop/:id')
  stopExam(@Param('id', ParseIntPipe) id: number) {
    return this.npuEvalService.stopNpuExam(id);
  }

  @Post('create')
  create(@Body() body: CreateNpuExamDto) {
    return this.npuEvalService.create(body);
  }

  @Patch('update/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateNpuExamDto: UpdateNpuExamDto,
  ) {
    return this.npuEvalService.update(id, updateNpuExamDto);
  }

  @Delete('delete/:id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.npuEvalService.remove(id);
  }

  // --- Results ---

  @Get('results/:examId')
  getResults(@Param('examId', ParseIntPipe) examId: number) {
    return this.npuEvalService.findAllResults(examId);
  }

  @Post('results/create')
  createResult(@Body() body: CreateNpuExamResultDto) {
    return this.npuEvalService.createResult(body);
  }

  // --- Comparison ---

  @Get('compare/:npuExamId/:gpuExamId')
  getComparison(
    @Param('npuExamId', ParseIntPipe) npuExamId: number,
    @Param('gpuExamId', ParseIntPipe) gpuExamId: number,
    @Query('gpuBenchmark') gpuBenchmark: string = 'mlperf',
  ) {
    // m-api1: validate the enum at runtime (the TS union is compile-time only).
    // Mirror the Loki/Comparison controllers and 400 on anything off-allowlist
    // instead of echoing a garbage gpu object.
    if (
      !ALLOWED_GPU_BENCHMARKS.includes(gpuBenchmark as AllowedGpuBenchmark)
    ) {
      throw new BadRequestException(
        `Invalid gpuBenchmark '${gpuBenchmark}'. Allowed: ${ALLOWED_GPU_BENCHMARKS.join(', ')}`,
      );
    }
    return this.npuEvalService.getComparisonData(
      npuExamId,
      gpuExamId,
      gpuBenchmark as AllowedGpuBenchmark,
    );
  }
}
