import { memo } from 'react';

import { Box } from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';

const uData = [4000, 3000, 2000, 2780, 1890, 2390, 3490];
const pData = [2400, 1398, 9800, 3908, 4800, 3800, 4300];
const xLabels = ['Page A', 'Page B', 'Page C', 'Page D', 'Page E', 'Page F', '100'];

export const LineGraph = memo(() => {
  return (
    <Box sx={{ width: '90%', height: 400 }}>
      <LineChart
        series={[
          { data: pData, label: 'pv', yAxisId: 'leftAxisId' },
          { data: uData, label: 'uv', yAxisId: 'leftAxisId' }
        ]}
        xAxis={[{ scaleType: 'point', data: xLabels }]}
        yAxis={[{ id: 'leftAxisId', width: 50 }]}
      />
    </Box>
  );
});
