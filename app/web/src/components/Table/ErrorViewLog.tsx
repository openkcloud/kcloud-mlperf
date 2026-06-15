import { Fragment, useState } from 'react';

import { Box, Button, Typography } from '@mui/material';

import { Modal } from '@/components/Modal';

// ----------------------------------------------------------------------

export const ErrorViewLog = (props: { message: string }) => {
  const { message } = props;

  const [isOpen, setIsOpen] = useState(false);

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <Fragment>
      <Button
        size="small"
        variant="contained"
        onClick={() => setIsOpen(true)}
        sx={{
          fontSize: '0.75rem',
          fontWeight: 600,
          height: 28,
          minWidth: 64,
          px: 1.5,
          borderRadius: '0.375rem',
          textTransform: 'none',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          background: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)',
          color: '#FFF',
          '&:hover': { background: 'linear-gradient(135deg, #D97706 0%, #F59E0B 100%)' }
        }}
      >
        Log
      </Button>
      <Modal open={isOpen} onClose={handleClose}>
        <Typography
          component={'h3'}
          fontSize={'1.5rem'}
          fontWeight={600}
          sx={theme => ({
            color: theme.palette.grey[900],
            lineHeight: '1.75rem'
          })}
          marginBottom={'0.875rem'}
        >
          Error Log
        </Typography>
        <Box
          sx={{
            backgroundColor: '#1e1e1e',
            p: 2,
            borderRadius: 2,
            fontFamily: 'monospace',
            fontSize: '14px',
            height: '420px',
            overflow: 'auto'
          }}
        >
          <Typography component={'p'} sx={{ m: 0 }} color={'error'}>
            {message || 'No any error message'}
          </Typography>
        </Box>
      </Modal>
    </Fragment>
  );
};
