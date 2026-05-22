import { memo, useState } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import { IconButton, Tooltip } from '@mui/material';
import { styled } from '@mui/material/styles';

// ----------------------------------------------------------------------

const SpinningIcon = styled(RefreshIcon, {
  shouldForwardProp: prop => prop !== 'isLoading'
})<{ isLoading: boolean }>(({ isLoading }) => ({
  fontSize: '1.125rem',
  transition: 'transform 0.3s ease',
  ...(isLoading && {
    animation: 'spin 1s linear infinite'
  }),
  '@keyframes spin': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' }
  }
}));

// ----------------------------------------------------------------------

type RefreshButtonProps = {
  onClick: () => Promise<any>;
};

// ----------------------------------------------------------------------

export const RefreshButton = memo<RefreshButtonProps>(props => {
  const { onClick } = props;

  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      await onClick();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Tooltip title="Refresh" placement="top">
      <span>
        <IconButton
          type="button"
          aria-label="Refresh"
          onClick={handleClick}
          disabled={isLoading}
          size="small"
          sx={{
            color: 'grey.500',
            transition: 'color 0.2s ease, background-color 0.2s ease',
            '&:hover': {
              color: '#4F46E5',
              backgroundColor: '#EEF2FF'
            },
            '&:active': {
              backgroundColor: '#E0E7FF'
            }
          }}
        >
          <SpinningIcon isLoading={isLoading} />
        </IconButton>
      </span>
    </Tooltip>
  );
});
