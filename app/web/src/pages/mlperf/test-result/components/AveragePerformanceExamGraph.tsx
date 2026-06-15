import { Fragment } from 'react';

import { Box } from '@mui/material';

import type { MpExamResultList } from '@/api/types/mp-exam.types';
import { BarGraph } from '@/components/Graphs/BarGraph';
import { TestScenarioEnum } from '@/enums/test-scenario.enum';

type AveragePerformanceExamGraphProps = Omit<
  MpExamResultList,
  | 'result_acc_rg_1'
  | 'result_acc_rg_2'
  | 'result_acc_rg_l'
  | 'result_acc_rg_lsum'
  | 'id'
  | 'exam_id'
  | 'created_at'
> & {
  test_scenario: TestScenarioEnum;
  test_name: string;
  gpu_type: string;
  repetitionCount: number;
};

export const AveragePerformanceExamGraph = (props: AveragePerformanceExamGraphProps) => {
  const {
    test_name,
    result_perf_sps,
    result_perf_tps,
    result_vram_peak,
    result_perf_latency,
    result_perf_serv_ttft,
    result_perf_serv_tpot,
    result_tt100t,
    result_gpu_util,
    result_perf_tps_best,
    gpu_type,
    test_scenario
  } = props;

  // Guard nullable metrics so the chart never receives undefined/NaN (bug #14).
  // Latency/TTFT/TPOT are stored in microseconds (→ ms); TT100T is already in seconds.
  const latencyGraphData =
    test_scenario === TestScenarioEnum.SERVER
      ? [
          {
            label: 'Latency',
            value: (result_perf_latency ?? 0) / 1_000_000
          },
          {
            label: 'TTFT',
            value: (result_perf_serv_ttft ?? 0) / 1_000_000
          },
          {
            label: 'TPOT',
            value: (result_perf_serv_tpot ?? 0) / 1_000_000
          },
          {
            label: 'TT100T',
            value: result_tt100t ?? 0
          }
        ]
      : [
          {
            label: 'Latency',
            value: (result_perf_latency ?? 0) / 1_000_000
          },
          {
            label: 'TT100T',
            value: result_tt100t ?? 0
          }
        ];

  // Dynamic upper bound so slow runs aren't hard-clipped at 2500ms (bug #24).
  const latencyAxisMax = Math.max(
    2_500,
    ...latencyGraphData.map(d => (Number.isFinite(d.value) ? d.value : 0) * 1.1)
  );

  return (
    <Fragment>
      <Box>
        <BarGraph
          layout={'horizontal'}
          dataset={[
            {
              label: 'Samples(queries) per second',
              value: result_perf_sps ?? 0
            },
            {
              label: 'Tokens per second',
              value: result_perf_tps ?? 0
            }
          ]}
          height={300}
          yAxis={[
            {
              width: 200,
              dataKey: 'label'
            }
          ]}
          xAxis={[
            {
              label: 'Value (seconds)'
            }
          ]}
          series={[
            {
              dataKey: 'value',
              label: `${test_scenario.toUpperCase()} Scenario - ${test_name} on ${gpu_type}`,
              color: '#4F46E5'
            }
          ]}
        />
        <BarGraph
          layout={'horizontal'}
          height={test_scenario === TestScenarioEnum.SERVER ? 520 : 300}
          dataset={latencyGraphData}
          yAxis={[
            {
              width: 200,
              dataKey: 'label'
            }
          ]}
          xAxis={[
            {
              label: 'Value (milliseconds)',
              min: 0,
              max: latencyAxisMax
            }
          ]}
          series={[
            {
              dataKey: 'value',
              color: '#4F46E5'
            }
          ]}
        />
        <BarGraph
          layout={'horizontal'}
          dataset={[
            {
              label: 'VRAM peak (GB)',
              value: result_vram_peak ?? 0
            },
            {
              label: 'GPU Util (avg %)',
              value: result_gpu_util ?? 0
            }
          ]}
          height={300}
          yAxis={[
            {
              width: 200,
              dataKey: 'label'
            }
          ]}
          xAxis={[
            {
              label: 'Value'
            }
          ]}
          series={[
            {
              dataKey: 'value',
              color: '#4F46E5'
            }
          ]}
          sx={{
            marginBottom: '2.5rem'
          }}
        />
      </Box>
      <Box
        sx={{
          width: '100%'
        }}
      >
        <BarGraph
          dataset={[
            {
              label: `Tokens/sec (${test_scenario.toUpperCase()})`,
              value1: result_perf_tps,
              value2: result_perf_tps_best
            }
          ]}
          xAxis={[
            {
              dataKey: 'label'
            }
          ]}
          yAxis={[
            {
              label: 'Tokens/sec (higher is better)',
              width: 120,
              max: 15_000
            }
          ]}
          series={[
            {
              dataKey: 'value1',
              label: `Your run (${gpu_type})`
            },
            {
              dataKey: 'value2',
              label: 'Best public (per GPU)'
            }
          ]}
        />
      </Box>
    </Fragment>
  );
};
