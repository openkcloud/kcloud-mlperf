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

import { useMmExamResultList } from '@/pages/mmlu/main/exam-table/useMmExamResultList';
import { useExamStatus } from '@/pages/mmlu/main/components/ExamStatusBadge/useExamStatus';

import { MmluPageLinks } from '@/contexts/RouterContext/router.links';

import { MmluExamActionButton } from '@/pages/mmlu/main/components/ActionButton';
import { MmluComparisonCheckbox } from '@/pages/mmlu/main/components/ComparisonCheckbox';
import { ExamStatusBadge } from '@/pages/mmlu/main/components/ExamStatusBadge';

// ----------------------------------------------------------------------

dayjs.extend(utc);
dayjs.extend(timezone);

// ----------------------------------------------------------------------

const RepetitionCell = memo<{ id: number; status: StatusEnum; retryNum: number }>(({ id, status, retryNum }) => {
  const examStatus = useExamStatus({ id, status, tablePageNumber: 1 });
  
  const currentRepeatCount = examStatus?.currentRepeatCount;
  
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
  const { onUseData } = props;
  const { mlExamIds } = useStore(store => store.testComparison);

  const navigate = useNavigate();

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE
  });

  const [searchTerm, setSearchTerm] = useState<string>('');

  const { data, refetchMmExamList } = useMmExamResultList({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
    search: searchTerm
  });

  const handleSearch = (search: string) => {
    setSearchTerm(search);
  };

  const filteredData = useMemo(() => {
    if (!data?.list) return [];
    if (!searchTerm) return data.list;

    const lowerSearchTerm = searchTerm.toLowerCase();
    return data.list.filter(
      item =>
        item.name.toLowerCase().includes(lowerSearchTerm) ||
        item.model.toLowerCase().includes(lowerSearchTerm) ||
        item.dataset.toLowerCase().includes(lowerSearchTerm) ||
        item.gpu_type.toLowerCase().includes(lowerSearchTerm)
    );
  }, [data?.list, searchTerm]);

  // const paginatedData = useMemo(() => {
  //   const startIndex = pagination.pageIndex * pagination.pageSize;
  //   const endIndex = startIndex + pagination.pageSize;
  //   return filteredData.slice(startIndex, endIndex);
  // }, [filteredData, pagination.pageIndex, pagination.pageSize]);

  // const pageCount = Math.ceil(filteredData.length / pagination.pageSize);

  if (!data || data?.list.length === 0) return null;

  return (
    <MMLUTable<MmExamResultList>
      data={filteredData}
      columns={createColumns(onUseData)}
      total={filteredData.length}
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
  );
});
