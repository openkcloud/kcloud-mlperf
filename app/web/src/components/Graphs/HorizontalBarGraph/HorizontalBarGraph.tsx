import { memo } from 'react';

import { Box } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';

const data = [
  { country: 'USA', value: 400 },
  { country: 'China', value: 300 },
  { country: 'Japan', value: 200 },
  { country: 'Germany', value: 278 }
];

export const HorizontalBarGraph = memo(() => {
  return (
    <Box sx={{ width: '100%' }}>
      <BarChart
        dataset={data}
        layout="horizontal" // 👈 makes it horizontal
        yAxis={[
          {
            label: 'Countries',
            width: 80,
            dataKey: 'country'
          }
        ]}
        series={[{ dataKey: 'value', label: 'GDP (Billion $)' }]}
        height={300}
      />
    </Box>
  );
});
