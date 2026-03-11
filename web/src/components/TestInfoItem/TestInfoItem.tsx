import { memo } from 'react';

import { Box } from '@mui/material';

type TestInfoItemProps = {
  label: string;
  value: string | number;
};

export const TestInfoItem = memo((props: TestInfoItemProps) => {
  const { label, value } = props;

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        component={'p'}
        sx={theme => ({
          fontSize: '0.875rem',
          lineHeight: '1.25rem',
          fontWeight: 400,
          marginBottom: '0.5rem',
          color: theme.palette.grey[900]
        })}
      >
        {label}
      </Box>
      <Box
        sx={theme => ({
          padding: '0.625rem 0.75rem',
          borderRadius: '0.5rem',
          backgroundColor: 'white',
          border: `1.5px solid ${theme.palette.grey[300]}`
        })}
      >
        {value}
      </Box>
    </Box>
  );
});
