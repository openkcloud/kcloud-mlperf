import {
  type TableOptions,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable
} from '@tanstack/react-table';

import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Table as MuiTable,
  TableBody as MuiTableBody,
  TableCell as MuiTableCell,
  TableHead as MuiTableHead,
  TableRow as MuiTableRow,
  Paper,
  type PaperProps,
  Select,
  TableContainer,
  Typography
} from '@mui/material';
import * as XLSX from 'xlsx';

import { RefreshButton } from '@/components/RefreshButton';
import { TableSearchInput } from '@/components/Table/TableSearchInput';

// ----------------------------------------------------------------------

const CustomPaper = (props: PaperProps) => (
  <Paper elevation={0} sx={{ boxShadow: 'none' }} {...props} />
);

// ----------------------------------------------------------------------

const isTest = false;

// ----------------------------------------------------------------------

type TableProps<TData> = Omit<
  TableOptions<TData>,
  'getCoreRowModel' | 'debugTable' | 'debugHeaders' | 'debugColumns'
> & {
  total: number;
  isLoading?: boolean;
  compareBtn: {
    disabled: boolean;
    onClick: VoidFunction;
  };
  onClickRefreshBtn: () => Promise<any>;
  onSearch?: (searchTerm: string) => void;
};

// ----------------------------------------------------------------------

export function MLPerfTable<TData>(props: TableProps<TData>) {
  const {
    total,
    isLoading,
    data,
    columns,
    compareBtn,
    onClickRefreshBtn,
    onSearch,
    ...restOfProps
  } = props;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    debugTable: isTest,
    debugHeaders: isTest,
    debugColumns: isTest,
    ...restOfProps
  });

  const downloadExcel = () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const excelBlob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const excelUrl = URL.createObjectURL(excelBlob);
    const link = document.createElement('a');
    link.href = excelUrl;
    link.download = 'MLPerf Test Results.xlsx';
    link.click();
  };

  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid #E2E8F0',
        borderRadius: '0.75rem',
        overflow: 'hidden'
      }}
    >
      {/* Table Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2.5,
          pt: 2.5,
          pb: 1.5
        }}
      >
        <Box
          sx={{
            width: 4,
            height: 20,
            borderRadius: 1,
            background: 'linear-gradient(180deg, #4F46E5 0%, #818CF8 100%)',
            flexShrink: 0
          }}
        />
        <Typography
          sx={{
            fontWeight: 700,
            color: '#1E293B',
            fontSize: '1rem',
            flex: 1
          }}
        >
          Test Results
        </Typography>
        <Box
          sx={{
            px: 1.5,
            py: 0.375,
            borderRadius: '9999px',
            bgcolor: '#EEF2FF',
            color: '#4F46E5',
            fontSize: '0.8125rem',
            fontWeight: 600
          }}
        >
          {total} total
        </Box>
      </Box>

      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
          px: 2.5,
          pb: 2,
          borderBottom: '1px solid #E2E8F0'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <RefreshButton onClick={onClickRefreshBtn} />
          <TableSearchInput onSearch={onSearch} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            sx={{ minWidth: 0, width: 32, height: 32, p: 0 }}
          >
            <ChevronLeft fontSize="small" />
          </Button>
          <Typography sx={{ fontSize: '0.8125rem', color: '#475569', fontWeight: 500, px: 0.5 }}>
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount().toLocaleString()}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            sx={{ minWidth: 0, width: 32, height: 32, p: 0 }}
          >
            <ChevronRight fontSize="small" />
          </Button>
          <FormControl size="small" sx={{ minWidth: 90, ml: 0.5 }}>
            <InputLabel id="mlperf-page-size">Rows</InputLabel>
            <Select
              labelId="mlperf-page-size"
              label="Rows"
              value={table.getState().pagination.pageSize}
              onChange={e => table.setPageSize(Number(e.target.value))}
              sx={{ height: 32, fontSize: '0.8125rem' }}
            >
              {[10, 20, 30, 50].map(pageSize => (
                <MenuItem key={pageSize} value={pageSize}>
                  {pageSize}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={downloadExcel}
            startIcon={<DownloadOutlinedIcon sx={{ fontSize: '1rem !important' }} />}
            sx={{ fontSize: '0.8125rem', height: 32 }}
          >
            Export
          </Button>
          <Button
            variant="contained"
            size="small"
            disabled={compareBtn.disabled}
            onClick={compareBtn.onClick}
            startIcon={<CompareArrowsIcon sx={{ fontSize: '1rem !important' }} />}
            sx={{ fontSize: '0.8125rem', height: 32 }}
          >
            Compare
          </Button>
        </Box>
      </Box>

      {/* Table */}
      <TableContainer
        component={CustomPaper}
        sx={{
          maxHeight: '60vh',
          overflowX: 'auto'
        }}
      >
        <MuiTable stickyHeader aria-label="MLPerf results table" sx={{ tableLayout: 'auto' }}>
          <MuiTableHead>
            {table.getHeaderGroups().map(headerGroup => (
              <MuiTableRow key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  const isLast = header.index === headerGroup.headers.length - 1;
                  return (
                    <MuiTableCell
                      key={header.id}
                      component={'th'}
                      sx={{
                        borderRight: !isLast ? '1px solid rgba(79,70,229,0.12)' : '',
                        whiteSpace: 'nowrap',
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                        background: 'linear-gradient(135deg, #EEF2FF 0%, #F0F9FF 100%)',
                        color: '#3730A3',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        borderBottom: '2px solid #C7D2FE',
                        py: 1,
                        px: 1
                      }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </MuiTableCell>
                  );
                })}
              </MuiTableRow>
            ))}
          </MuiTableHead>
          <MuiTableBody>
            {table.getRowModel().rows.length === 0 ? (
              <MuiTableRow>
                <MuiTableCell
                  colSpan={columns.length}
                  sx={{
                    textAlign: 'center',
                    py: 6,
                    color: '#94A3B8',
                    fontSize: '0.9375rem'
                  }}
                >
                  No test results yet. Create a test above to get started.
                </MuiTableCell>
              </MuiTableRow>
            ) : (
              table.getRowModel().rows.map((row, idx) => (
                <MuiTableRow
                  key={row.id}
                  hover
                  sx={{
                    backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#FAFBFE',
                    '&:hover': { backgroundColor: '#EEF2FF !important' }
                  }}
                >
                  {row.getVisibleCells().map(cell => (
                    <MuiTableCell
                      key={cell.id}
                      sx={{
                        whiteSpace: 'nowrap',
                        fontSize: '0.8125rem',
                        py: 0.75,
                        px: 1,
                        borderBottom: '1px solid #F1F5F9'
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </MuiTableCell>
                  ))}
                </MuiTableRow>
              ))
            )}
          </MuiTableBody>
        </MuiTable>
      </TableContainer>
    </Paper>
  );
}
