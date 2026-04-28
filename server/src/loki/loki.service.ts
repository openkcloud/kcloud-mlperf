import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import { LokiInstantQueryResponseDto } from './dto/loki-instant-query-response.dto';

@Injectable()
export class LokiService {
  private readonly logger = new Logger(LokiService.name);
  private readonly baseUrl = process.env.LOKI_URL || '';

  constructor(private readonly http: HttpService) {}

  /**
   * Instant Query (latest logs)
   */
  async instantQuery(params: {
    id: number;
    benchmark: 'mmlu' | 'mlperf';
  }): Promise<LokiInstantQueryResponseDto> {
    const { id, benchmark } = params;

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/loki/api/v1/query`, {
          params: { query: `{id="${benchmark}-${id}"}` },
        }),
      );
      return response.data as LokiInstantQueryResponseDto;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Return a safe fallback so callers can still access .data.result without throwing
      this.logger.warn(`Loki unavailable: ${errMsg}`);
      return {
        status: 'unavailable',
        data: {
          resultType: 'streams',
          result: [],
          stats: {
            summary: { bytesProcessedPerSecond: 0, linesProcessedPerSecond: 0, totalBytesProcessed: 0, totalLinesProcessed: 0, execTime: 0 },
            store: { totalChunksRef: 0, totalChunksDownloaded: 0, chunksDownloadTime: 0, headChunkBytes: 0, headChunkLines: 0, decompressedBytes: 0, decompressedLines: 0, compressedBytes: 0, totalDuplicates: 0 },
            ingester: { totalReached: 0, totalChunksMatched: 0, totalBatches: 0, totalLinesSent: 0, headChunkBytes: 0, headChunkLines: 0, decompressedBytes: 0, decompressedLines: 0, compressedBytes: 0, totalDuplicates: 0 },
          },
        },
      };
    }
  }
}
