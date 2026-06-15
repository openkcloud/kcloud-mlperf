import { type ColumnDef, type PaginationState } from '@tanstack/react-table';
import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Box, Typography } from '@mui/material';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import type { MmExamResultList } from '@/api/types/mm-exam.types';
import { MMLUTable } from '@/components/Table/MMluTable';
import { SelectedTestResultCount } from '@/constants/test-comparison.constants';
import { TIMEZONE } from '@/constants/timezone.constants.ts';
import { type StatusEnum } from '@/enums/status.enum';
import { useStore } from '@/store';

import { QueryBoundary } from '@/components/QueryBoundary';
import { useMmExamResultList } from '@/pages/mmlu/main/exam-table/useMmExamResultList';
import { useQueryClient } from '@tanstack/react-query';
import { MmExamQueryKeys } from '@/contexts/QueryContext/query.keys';
import type { ExamStatusResponse } from '@/api/types/common.types';

import { MmluPageLinks } from '@/contexts/RouterContext/router.links';

import { MmluExamActionButton } from '@/pages/mmlu/main/components/ActionButton';
import { MmluComparisonCheckbox } from '@/pages/mmlu/main/components/ComparisonCheckbox';
import { ExamStatusBadge } from '@/pages/mmlu/main/components/ExamStatusBadge';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

const RepetitionCell = memo<{ id: number; status: StatusEnum; retryNum: number }>(({ id, status, retryNum }) => {
  // Read from the query cache without adding a second polling observer.
  // ExamStatusBadge (via useExamStatus) already polls this key every 3 s;
  // reading the cached value here avoids duplicate network timers.
  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData<ExamStatusResponse>(MmExamQueryKeys.checkExamStatus(id));
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

type MmluExamResultTableProps = {
  onUseData?: (exam: MmExamResultList) => void;
  hideSweepRuns?: boolean;
};

const createColumns = (
  onUseData?: (exam: MmExamResultList) => void
): ColumnDef<MmExamResultList>[] => [
  {
    accessorKey: 'id',
    header: 'ID',
    cell: info => info.getValue()
  },
  {
    header: 'Test name',
    accessorFn: row => ({ id: row.id, name: row.name }),
    cell: info => {
      const { name } = info.getValue() as { id: number; name: string };

      return (
        <Typography
          component={'div'}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          {name}
        </Typography>
      );
    }
  },
  {
    id: 'typeOfExam',
    header: 'Type of test',
    cell: () => 'MMLU-Pro'
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
    accessorFn: row => ({ gpuType: row.gpu_type, gpuNum: row.gpu_num }),
    header: 'GPU',
    cell: info => {
      const { gpuType, gpuNum } = info.getValue() as { gpuType: string; gpuNum: number };
      return `${gpuType} x${gpuNum}`;
    }
  },
  {
    id: 'status',
    accessorFn: row => ({ id: row.id, status: row.status }),
    header: 'Status',
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
    accessorKey: 'comparison',
    header: 'Comparison',
    accessorFn: row => ({ id: row.id, status: row.status }),
    cell: info => {
      const { id, status } = info.getValue() as { id: number; status: StatusEnum };

      return <MmluComparisonCheckbox id={id} disabled={status !== 'Completed'} />;
    }
  },
  {
    id: 'action',
    header: 'Action',
    accessorFn: row => row,
    cell: info => {
      const exam = info.getValue() as MmExamResultList;
      const { pageIndex } = info.table.getState().pagination;

      return (
        <MmluExamActionButton
          key={exam.id}
          id={exam.id}
          name={exam.name}
          status={exam.status}
          tablePageNumber={pageIndex + 1}
          errorLog={exam.error_log || null}
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

export const MmluExamResultTable = memo((props: MmluExamResultTableProps) => {
  const { onUseData, hideSweepRuns = false } = props;
  const { mlExamIds } = useStore(store => store.testComparison);

  const navigate = useNavigate();

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE
  });

  const [searchTerm, setSearchTerm] = useState<string>('');

  const { data, refetchMmExamList, query } = useMmExamResultList({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    search: searchTerm
  });

  const handleSearch = (search: string) => {
    setSearchTerm(search);
    setPagination(prev => ({ ...prev, pageIndex: 0 }));
  };

  const filteredData = useMemo(() => {
    if (!data?.list) return [];

    return hideSweepRuns
      ? data.list.filter(item => !item.description?.startsWith('[sweep:'))
      : data.list;
  }, [data?.list, hideSweepRuns]);

  return (
    <QueryBoundary query={query} isEmpty={d => !d || d.list.length === 0}>
      <MMLUTable<MmExamResultList>
        data={filteredData}
        columns={createColumns(onUseData)}
        total={data?.total ?? 0}
        manualPagination
        pageCount={data?.total_pages ?? -1}
        state={{
          pagination
        }}
        onPaginationChange={setPagination}
        onClickRefreshBtn={() => refetchMmExamList()}
        compareBtn={{
          disabled: mlExamIds.length !== SelectedTestResultCount,
          onClick: () =>
            navigate(MmluPageLinks.testComparison(mlExamIds[0], mlExamIds[1]), {
              preventScrollReset: true
            })
        }}
        onSearch={handleSearch}
      />
    </QueryBoundary>
  );
});
