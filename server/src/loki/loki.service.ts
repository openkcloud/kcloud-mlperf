import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import { LokiInstantQueryResponseDto } from './dto/loki-instant-query-response.dto';

@Injectable()
export class LokiService {
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

    const response = await firstValueFrom(
      this.http.get(`${this.baseUrl}/loki/api/v1/query`, {
        params: { query: `{id="${benchmark}-${id}"}` },
      }),
    );

    return response.data as LokiInstantQueryResponseDto;
  }
}
