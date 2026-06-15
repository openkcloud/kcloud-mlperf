import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GpuSweepService } from './gpu-sweep.service';
import { GpuSweepMode } from './entities/gpu-sweep.entity';
import { StartSweepDto } from './dto/gpu-sweep.dto';
import type {
  CalibrationResponse,
  SweepPreviewResponse,
  SweepStatusResponse,
  SweepOptionsResponse,
} from './dto/gpu-sweep.dto';

@Controller('gpu-sweep')
export class GpuSweepController {
  constructor(private readonly service: GpuSweepService) {}

  // Phase -1: pure-compute preview, never writes to the DB. Always available
  // regardless of GPU_SWEEP_ENABLED so operators can rehearse before the demo.
  @Get('preview')
  preview(@Query('config') config?: string): SweepPreviewResponse {
    let parsed: Record<string, unknown> = {};
    if (config) {
      try {
        parsed = JSON.parse(config);
      } catch {
        parsed = {};
      }
    }
    return this.service.preview(parsed);
  }

  @Get('status')
  status(): Promise<SweepStatusResponse> {
    return this.service.getStatus();
  }

  // Always returns the full catalogue. When the feature is disabled or a node
  // is not yet ready, options remain in the response with disabled=true and a
  // machine-readable reason so the UI can render them with a tooltip.
  @Get('options')
  options(): SweepOptionsResponse {
    return this.service.getOptions();
  }

  @Get('cells/:sweepId')
  async listCells(@Param('sweepId', ParseIntPipe) sweepId: number) {
    const cells = await this.service.listCells(sweepId);
    return { sweep_id: sweepId, cells, total: cells.length };
  }

  @Post('start')
  async start(@Body() body: StartSweepDto) {
    if (!this.service.isEnabled()) {
      throw new ServiceUnavailableException({ enabled: false });
    }
    if (body.mode === GpuSweepMode.CALIBRATION) {
      const result: CalibrationResponse = await this.service.runCalibration();
      return result;
    }
    return this.service.startSweep(body);
  }

  /** Zero-arg variants — operate on the currently active sweep. */
  @Patch('pause')
  pauseActive() {
    return this.service.pauseActiveSweep();
  }

  @Patch('drain')
  drainActive() {
    return this.service.drainActiveSweep();
  }

  @Patch('pause/:id')
  pause(@Param('id', ParseIntPipe) id: number) {
    return this.service.pause(id);
  }

  @Patch('drain/:id')
  drain(@Param('id', ParseIntPipe) id: number) {
    return this.service.drain(id);
  }
}
