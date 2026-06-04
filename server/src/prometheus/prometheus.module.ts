import { Module } from '@nestjs/common';
import { PrometheusClient } from './prometheus.client';
import { PowerCaptureService } from './power-capture.service';

@Module({
  providers: [PrometheusClient, PowerCaptureService],
  exports: [PrometheusClient, PowerCaptureService],
})
export class PrometheusModule {}
