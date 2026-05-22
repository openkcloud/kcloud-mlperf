import { type ColumnDef, type PaginationState } from '@tanstack/react-table';
import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Box, Chip, Typography } from '@mui/material';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import type { MpExamDetails } from '@/api/types/mp-exam.types';
import { MLPerfTable } from '@/components/Table';
import { SelectedTestResultCount } from '@/constants/test-comparison.constants';
import { TIMEZONE } from '@/constants/timezone.constants';
import type { StatusEnum } from '@/enums/status.enum';
import { useStore } from '@/store';

import { QueryBoundary } from '@/components/QueryBoundary';
import { useMpExamResultList } from '@/pages/mlperf/main/exam-table/useMpExamResultList';
import { useMpExamResultsList } from '@/pages/mlperf/main/exam-table/useMpExamResultsList';
import { useQueryClient } from '@tanstack/react-query';
import { MpExamQueryKeys } from '@/contexts/QueryContext/query.keys';
import type { ExamStatusResponse } from '@/api/types/common.types';


import { MpExamPageLinks } from '@/contexts/RouterContext/router.links.ts';

import MlPerfExamActionButton from '@/pages/mlperf/main/components/ActionButton';
import { MlperfComparisonCheckbox } from '@/pages/mlperf/main/components/ComparisonCheckbox';
import { ExamStatusBadge } from '@/pages/mlperf/main/components/ExamStatusBadge';
// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

const RepetitionCell = memo<{ id: number; status: StatusEnum; retryNum: number }>(({ id, status, retryNum }) => {
  // Read from the query cache without adding a second polling observer.
  // ExamStatusBadge (via useMpExamStatus) already polls this key every 3 s;
  // reading the cached value here avoids duplicate network timers.
  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData<ExamStatusResponse>(MpExamQueryKeys.checkExamStatus(id));
  const currentRepeatCount = cached?.currentRepeatCount;

  if (!currentRepeatCount) {
    return <Typography variant="body2">{retryNum}</Typography>;
  }

  return (
    <Typography variant="body2">
      {status === 'Running' || status === 'Preparing'
        ? `${currentRepeatCount}/${retryNum}`
        : `${retryNum}`
      }
    </Typography>
  );
});

// ----------------------------------------------------------------------

type MlperfExamResultTableProps = {
  onUseData?: (exam: MpExamDetails) => void;
  hideSweepRuns?: boolean;
};

const createColumns = (
  onUseData?: (exam: MpExamDetails) => void,
  bestPerfExamId?: number,
  bestAccExamId?: number | undefined
): ColumnDef<MpExamDetails>[] => [
  {
    header: 'ID',
    accessorKey: 'id'
  },
  {
    accessorKey: 'name',
    header: 'Test name',
    cell: info => info.getValue()
  },
  {
    accessorKey: 'scenario',
    header: 'Scenario',
    cell: info => {
      const value = (info.getValue() as string).toUpperCase();
      const isServer = value === 'SERVER';
      return (
        <Chip
          size="small"
          label={value}
          sx={{
            fontWeight: 600,
            fontSize: '0.6875rem',
            height: 24,
            bgcolor: isServer ? '#F0F9FF' : '#FFFBEB',
            color: isServer ? '#0369A1' : '#92400E',
            border: `1px solid ${isServer ? '#BAE6FD' : '#FDE68A'}`,
          }}
        />
      );
    }
  },
  {
    id: 'typeOfExam',
    header: 'Type of test',
    cell: () => 'MLPerf'
  },
  {
    accessorKey: 'model',
    header: 'Model',
    cell: info => info.getValue()
  },
  {
    accessorKey: 'dataset',
    header: 'Dataset'
  },
  {
    accessorKey: 'mode',
    header: 'Test mode',
    cell: info => {
      const value = (info.getValue() as string).toUpperCase();
      const isPerformance = value === 'PERFORMANCE';
      return (
        <Chip
          size="small"
          label={value}
          sx={{
            fontWeight: 600,
            fontSize: '0.6875rem',
            height: 24,
            bgcolor: isPerformance ? '#ECFDF5' : '#EEF2FF',
            color: isPerformance ? '#065F46' : '#3730A3',
            border: `1px solid ${isPerformance ? '#A7F3D0' : '#C7D2FE'}`,
          }}
        />
      );
    }
  },
  {
    accessorFn: row => ({ gpuType: row.gpu_type, gpuNum: row.gpu_num }),
    header: 'GPU',
    cell: info => {
      const { gpuType, gpuNum } = info.getValue() as { gpuType: string; gpuNum: number };
      return `${gpuType} x${gpuNum}`;
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    accessorFn: row => ({ status: row.status, id: row.id }),
    cell: info => {
      const { id, status } = info.getValue() as { id: number; status: StatusEnum };
      const { pageIndex } = info.table.getState().pagination;

      return (
        <Box key={id} minWidth={120}>
          <ExamStatusBadge id={id} status={status} tablePageNumber={pageIndex + 1} />
        </Box>
      );
    }
  },
  {
    id: 'repetition',
    accessorFn: row => ({ id: row.id, status: row.status, retryNum: row.retry_num }),
    header: 'Repetition',
    cell: info => {
      const { id, status, retryNum } = info.getValue() as { 
        id: number; 
        status: StatusEnum; 
        retryNum: number;
      };

      return <RepetitionCell id={id} status={status} retryNum={retryNum} />;
    }
  },
  {
    accessorKey: 'started_at',
    header: 'Start time',
    cell: info => {
      const time = info.getValue() as string;

      return dayjs(time).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
    }
  },
  {
    id: 'best',
    header: 'Best',
    cell: info => {
      const exam = info.row.original;
      if (bestPerfExamId === exam.id) {
        return (
          <Chip
            size="small"
            label="Best Performance"
            sx={{
              bgcolor: '#ECFDF5',
              color: '#065F46',
              border: '1px solid #A7F3D0',
              fontWeight: 600,
              fontSize: '0.6875rem'
            }}
          />
        );
      }
      if (bestAccExamId === exam.id) {
        return (
          <Chip
            size="small"
            label="Best Accuracy"
            sx={{
              bgcolor: '#EEF2FF',
              color: '#3730A3',
              border: '1px solid #C7D2FE',
              fontWeight: 600,
              fontSize: '0.6875rem'
            }}
          />
        );
      }
      return <Typography variant="body2" sx={{ color: '#CBD5E1' }}>—</Typography>;
    }
  },
  {
    accessorKey: 'comparison_action',
    header: 'Comparison',
    accessorFn: row => row,
    cell: info => {
      const row = info.getValue() as MpExamDetails;
      return (
        <MlperfComparisonCheckbox
          id={row.id}
          disabled={row.status !== 'Completed'}
          examMode={row.mode}
          precision={row.precision}
          model={row.model}
          dataset={row.dataset}
          scenario={row.scenario}
          maxOutputTokens={row.max_output_tokens ?? null}
          dataNumber={row.data_number}
        />
      );
    }
  },
  {
    id: 'action',
    header: 'Action',
    accessorFn: row => row,
    cell: info => {
      const exam = info.getValue() as MpExamDetails;
      const { pageIndex } = info.table.getState().pagination;

      return (
        <MlPerfExamActionButton
          key={exam.id}
          id={exam.id}
          name={exam.name}
          status={exam.status}
          tablePageNumber={pageIndex + 1}
          errorLog={exam.error_log}
          exam={exam}
          onUseData={onUseData}
        />
      );
    }
  }
];

// ----------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 10 as const;

// ----------------------------------------------------------------------

export const MlperfExamResultTable = memo((props: MlperfExamResultTableProps) => {
  const { onUseData, hideSweepRuns = false } = props;
  const { mpExamIds } = useStore(store => store.testComparison);

  const navigate = useNavigate();

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE
  });

  const [searchTerm, setSearchTerm] = useState<string>('');

  // Don't pass "best" search to API, handle it client-side
  const apiSearchTerm = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase().trim();
    if (
      lowerSearchTerm === 'best' ||
      lowerSearchTerm === 'best perf' ||
      lowerSearchTerm === 'best acc' ||
      lowerSearchTerm === 'best accuracy' ||
      lowerSearchTerm === 'best performance'
    ) {
      return undefined;
    }
    return searchTerm;
  }, [searchTerm]);

  const { data, refetchMpExamList, query } = useMpExamResultList({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    search: apiSearchTerm
  });

  const { list: resultsList } = useMpExamResultsList({
    page: 1,
    limit: 1000 // fetch all results for global best-badge detection
  });

  const bestPerfExamId = useMemo(() => {
    if (!resultsList || resultsList.length === 0) return undefined;

    const maxResultPerfTpsItem = resultsList.reduce((max, current) => {
      const currentTps = current.result_perf_tps ?? -Infinity;
      const maxTps = max.result_perf_tps ?? -Infinity;
      return currentTps > maxTps ? current : max;
    });

    return maxResultPerfTpsItem?.exam_id;
  }, [resultsList]);

  const handleSearch = (search: string) => {
    setSearchTerm(search);
    setPagination(prev => ({ ...prev, pageIndex: 0 }));
  };
  const bestAccExamId = useMemo(() => {
    if (!resultsList || resultsList.length === 0) return undefined;
    const maxResultPerfAccItem = resultsList.reduce((max, current) => {
      const currentAcc = current.result_acc_rg_l ?? -Infinity;
      const maxAcc = max.result_acc_rg_l ?? -Infinity;
      return currentAcc > maxAcc ? current : max;
    });
    return maxResultPerfAccItem?.exam_id;
  }, [resultsList]);

  const filteredData = useMemo(() => {
    if (!data?.list) return [];

    return hideSweepRuns
      ? data.list.filter(item => !item.description?.startsWith('[sweep:'))
      : data.list;
  }, [data?.list, hideSweepRuns]);

  const totalCount = data?.total ?? 0;

  return (
    <QueryBoundary query={query} isEmpty={d => !d || d.list.length === 0}>
      <MLPerfTable<MpExamDetails>
        data={filteredData}
        columns={createColumns(onUseData, bestPerfExamId, bestAccExamId)}
        total={totalCount}
        manualPagination
        pageCount={data?.total_pages ?? -1}
        state={{
          pagination
        }}
        onPaginationChange={setPagination}
        onClickRefreshBtn={() => refetchMpExamList()}
        compareBtn={{
          disabled: mpExamIds.length !== SelectedTestResultCount,
          onClick: () =>
            navigate(MpExamPageLinks.testComparison(mpExamIds[0], mpExamIds[1]), {
              preventScrollReset: true
            })
        }}
        onSearch={handleSearch}
      />
    </QueryBoundary>
  );
});
