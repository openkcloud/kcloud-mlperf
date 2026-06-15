import type { ReactNode } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import {
  Box,
  IconButton,
  Modal as MuiModal,
  type ModalProps as MuiModalProps
} from '@mui/material';

const style = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 420,
  bgcolor: 'background.paper',
  p: 0,
  borderRadius: '1rem',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.18), 0 8px 16px -8px rgba(0, 0, 0, 0.08)',
  overflow: 'hidden'
};

export const ExamCreateModal = (
  props: Omit<MuiModalProps, 'children'> & {
    children: ReactNode;
    hasCloseIcon?: boolean;
    title?: string;
  }
) => {
  const { children, onClose, hasCloseIcon = true, title, ...rest } = props;

  return (
    <MuiModal
      aria-labelledby="modal-modal-title"
      aria-describedby="modal-modal-description"
      onClose={onClose}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(4px)'
          }
        }
      }}
      {...rest}
    >
      <Box sx={style}>
        {/* Modal header bar */}
        {(title || hasCloseIcon) && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem 1.25rem',
              borderBottom: '1px solid',
              borderColor: 'grey.200',
              background: 'linear-gradient(135deg, #F5F3FF 0%, #E0F2FE 100%)'
            }}
          >
            {title ? (
              <Box
                component="h2"
                id="modal-modal-title"
                sx={{
                  fontSize: '1.0625rem',
                  fontWeight: 600,
                  color: '#1E1B4B',
                  margin: 0
                }}
              >
                {title}
              </Box>
            ) : (
              <Box />
            )}
            {hasCloseIcon && (
              <IconButton
                onClick={event => onClose?.(event, 'escapeKeyDown')}
                size="small"
                sx={{
                  color: 'grey.500',
                  transition: 'color 0.2s ease, background-color 0.2s ease',
                  '&:hover': {
                    color: '#4F46E5',
                    backgroundColor: '#EEF2FF'
                  }
                }}
              >
                <CloseIcon sx={{ fontSize: '1.125rem' }} />
              </IconButton>
            )}
          </Box>
        )}

        {/* Modal body */}
        <Box sx={{ padding: '1.5rem' }}>{children}</Box>
      </Box>
    </MuiModal>
  );
};
