import { Fragment } from 'react';

import { Box } from '@mui/material';

import type { MpExamResultList } from '@/api/types/mp-exam.types';
import { BarGraph } from '@/components/Graphs/BarGraph';
import { TestScenarioEnum } from '@/enums/test-scenario.enum';

type PerformanceComparisonGraphProps = {
  result1: Pick<
    MpExamResultList,
    | 'result_perf_sps'
    | 'result_perf_tps'
    | 'result_vram_peak'
    | 'result_perf_latency'
    | 'result_perf_serv_ttft'
    | 'result_perf_serv_tpot'
    | 'result_tt100t'
    | 'result_gpu_util'
    | 'result_perf_tps_best'
  > & {
    test_scenario: TestScenarioEnum;
    test_name: string;
    gpu_type: string;
  };
  result2: Pick<
    MpExamResultList,
    | 'result_perf_sps'
    | 'result_perf_tps'
    | 'result_vram_peak'
    | 'result_perf_latency'
    | 'result_perf_serv_ttft'
    | 'result_perf_serv_tpot'
    | 'result_tt100t'
    | 'result_gpu_util'
    | 'result_perf_tps_best'
  > & {
    test_scenario: TestScenarioEnum;
    test_name: string;
    gpu_type: string;
  };
};

export const PerformanceComparisonGraph = (props: PerformanceComparisonGraphProps) => {
  const { result1, result2 } = props;

  return (
    <Fragment>
      <Box>
        <BarGraph
          layout={'horizontal'}
          dataset={[
            {
              label: 'Samples(queries) per second',
              value1: result1.result_perf_sps ?? 0,
              value2: result2.result_perf_sps ?? 0
            },
            {
              label: 'Tokens per second',
              value1: result1.result_perf_tps ?? 0,
              value2: result2.result_perf_tps ?? 0
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
              dataKey: 'value1',
              label: `${result1.test_scenario.toUpperCase()} Scenario - ${result1.test_name} on ${result1.gpu_type}`
            },
            {
              dataKey: 'value2',
              label: `${result2.test_scenario.toUpperCase()} Scenario - ${result2.test_name} on ${result2.gpu_type}`
            }
          ]}
        />
        <BarGraph
          layout={'horizontal'}
          height={520}
          dataset={[
            {
              label: 'Latency',
              value1: (result1.result_perf_latency ?? 0) / 1_000_000,
              value2: (result2.result_perf_latency ?? 0) / 1_000_000
            },
            {
              label: 'TTFT',
              value1:
                result1.test_scenario === TestScenarioEnum.SERVER
                  ? (result1.result_perf_serv_ttft ?? 0) / 1_000_000
                  : 0,
              value2:
                result2.test_scenario === TestScenarioEnum.SERVER
                  ? (result2.result_perf_serv_ttft ?? 0) / 1_000_000
                  : 0
            },
            {
              label: 'TPOT',
              value1:
                result1.test_scenario === TestScenarioEnum.SERVER
                  ? (result1.result_perf_serv_tpot ?? 0) / 1_000_000
                  : 0,
              value2:
                result2.test_scenario === TestScenarioEnum.SERVER
                  ? (result2.result_perf_serv_tpot ?? 0) / 1_000_000
                  : 0
            },
            {
              label: 'TT100T',
              value1: result1.result_tt100t ?? 0,
              value2: result2.result_tt100t ?? 0
            }
          ]}
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
              max: 2_500
            }
          ]}
          series={[
            {
              dataKey: 'value1'
            },
            {
              dataKey: 'value2'
            }
          ]}
        />
        <BarGraph
          layout={'horizontal'}
          dataset={[
            {
              label: 'VRAM peak (GB)',
              value1: result1.result_vram_peak ?? 0,
              value2: result2.result_vram_peak ?? 0
            },
            {
              label: 'GPU Util (avg %)',
              value1: result1.result_gpu_util ?? 0,
              value2: result2.result_gpu_util ?? 0
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
              dataKey: 'value1'
            },
            {
              dataKey: 'value2'
            }
          ]}
          sx={{
            marginBottom: '2.5rem'
          }}
        />
      </Box>

      <BarGraph
        dataset={[
          {
            label: `Tokens/sec`,
            value1: result1.result_perf_tps ?? 0,
            value2: result1.result_perf_tps_best ?? 0,
            value3: result2.result_perf_tps ?? 0,
            value4: result2.result_perf_tps_best ?? 0
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
            label: `${result1.test_name} - Your run (${result1.gpu_type})`
          },
          {
            dataKey: 'value2',
            label: `${result1.test_name} - Best public (per GPU)`
          },
          {
            dataKey: 'value3',
            label: `${result2.test_name} - Your run (${result2.gpu_type})`
          },
          {
            dataKey: 'value4',
            label: `${result2.test_name} - Best public (per GPU)`
          }
        ]}
      />
    </Fragment>
  );
};
