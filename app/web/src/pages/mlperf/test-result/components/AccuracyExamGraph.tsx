import { Box } from '@mui/material';
import { ChartsReferenceLine } from '@mui/x-charts';

import type { MpExamResultList } from '@/api/types/mp-exam.types';
import { BarGraph } from '@/components/Graphs/BarGraph';

type AccuracyExamGraphProps = Pick<
  MpExamResultList,
  'result_acc_rg_1' | 'result_acc_rg_2' | 'result_acc_rg_l' | 'result_acc_rg_lsum'
> & { result_number: number };

export const AccuracyExamGraph = (props: AccuracyExamGraphProps) => {
  const { result_acc_rg_1, result_acc_rg_2, result_acc_rg_l, result_acc_rg_lsum, result_number } =
    props;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', lg: 'row' },
        alignItems: 'stretch',
        gap: 2,
        width: '100%'
      }}
    >
      <BarGraph
        dataset={[
          {
            label: 'ROUGE-1',
            value: result_acc_rg_1
          },
          {
            label: 'ROUGE-2',
            value: result_acc_rg_2
          },
          {
            label: 'ROUGE-L',
            value: result_acc_rg_l
          },
          {
            label: 'ROUGE-Lsum',
            value: result_acc_rg_lsum
          }
        ]}
        xAxis={[
          {
            dataKey: 'label'
          }
        ]}
        yAxis={[
          {
            label: 'Accuracy',
            width: 60
          }
        ]}
        series={[
          {
            dataKey: 'value',
            label: `MLPerf LLM Accuracy (Repetition ${result_number})`
          }
        ]}
      />
      <BarGraph
        dataset={[
          {
            label: 'ROUGE-1',
            value: ((result_acc_rg_1 ?? 0) / 38.7792) * 100
          },
          {
            label: 'ROUGE-2',
            value: ((result_acc_rg_2 ?? 0) / 15.9075) * 100
          },
          {
            label: 'ROUGE-L',
            value: ((result_acc_rg_l ?? 0) / 24.4957) * 100
          },
          {
            label: 'ROUGE-Lsum',
            value: ((result_acc_rg_lsum ?? 0) / 35.793) * 100
          }
        ]}
        xAxis={[
          {
            dataKey: 'label'
          }
        ]}
        yAxis={[
          {
            label: '% of reference',
            width: 60,
            min: 0,
            max: 100
          }
        ]}
        series={[
          {
            dataKey: 'value',
            label: `MLPerf LLM ROUGE Compliance (Repetition ${result_number})`,
            valueFormatter: value => `${value!.toFixed(2)}%`
          }
        ]}
      >
        {/* Orange line at Y = 90 */}
        <ChartsReferenceLine
          y={90}
          lineStyle={{
            stroke: 'orange',
            strokeWidth: 2
          }}
          label="90"
          labelStyle={{
            fill: 'orange',
            fontWeight: 600
          }}
          labelAlign="end"
        />

        {/* Green line at Y = 99.9 */}
        <ChartsReferenceLine
          y={99.9}
          lineStyle={{
            stroke: 'green',
            strokeWidth: 2
          }}
          label="99.9"
          labelStyle={{
            fill: 'green',
            fontWeight: 600
          }}
          labelAlign="end"
        />
      </BarGraph>
    </Box>
  );
};
