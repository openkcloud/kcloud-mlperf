import { memo, useEffect, useState } from 'react';

import { CheckCircle, Close, Error, Info, Warning } from '@mui/icons-material';
import {
  IconButton,
  Slide,
  type SlideProps,
  Snackbar,
  type SnackbarCloseReason,
  SnackbarContent
} from '@mui/material';
import { amber, green } from '@mui/material/colors';
import { styled } from '@mui/material/styles';
import clsx from 'clsx';

import { useStore } from '@/store';

// ----------------------------------------------------------------------

const PREFIX = 'AppMessageView';

const classes = {
  success: `${PREFIX}-success`,
  error: `${PREFIX}-error`,
  info: `${PREFIX}-info`,
  warning: `${PREFIX}-warning`,
  icon: `${PREFIX}-icon`,
  iconVariant: `${PREFIX}-iconVariant`,
  message: `${PREFIX}-message`
};

const variantIcon = {
  success: CheckCircle,
  warning: Warning,
  error: Error,
  info: Info
};

// ----------------------------------------------------------------------

const StyledSnackbar = styled(Snackbar)(({ theme }) => ({
  [`& .${classes.success}`]: {
    backgroundColor: green[600]
  },

  [`& .${classes.error}`]: {
    backgroundColor: theme.palette.error.main
  },

  [`& .${classes.info}`]: {
    backgroundColor: theme.palette.primary.light
  },

  [`& .${classes.warning}`]: {
    backgroundColor: amber[700]
  },

  [`& .${classes.icon}`]: {
    fontSize: 20
  },

  [`& .${classes.iconVariant}`]: {
    opacity: 0.9,
    marginRight: theme.spacing(1)
  },

  [`& .${classes.message}`]: {
    display: 'flex',
    alignItems: 'center'
  }
}));

const TransitionLeft = (props: SlideProps) => {
  return <Slide {...props} direction="left" />;
};

// ----------------------------------------------------------------------

export const AppMessageView = memo((props: { className?: string }) => {
  const { className } = props;

  const { message, type, clearNotification } = useStore(store => store.notification);
  const [isOpen, setIsOpen] = useState(false);

  const Icon = variantIcon[type];

  useEffect(() => {
    if (message) {
      setIsOpen(true);
    }
  }, [message]);

  const handleClose = (_: React.SyntheticEvent | Event, reason?: SnackbarCloseReason) => {
    if (reason === 'clickaway') {
      return;
    }

    setIsOpen(false);
    clearNotification();
  };

  return (
    <StyledSnackbar
      open={isOpen}
      autoHideDuration={3000}
      onClose={handleClose}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'right'
      }}
      slots={{
        transition: TransitionLeft
      }}
    >
      <SnackbarContent
        className={clsx(classes[type], className)}
        aria-describedby="client-snackbar"
        message={
          <span id="client-snackbar" className={classes.message}>
            <Icon className={clsx(classes.icon, classes.iconVariant)} />
            {message}
          </span>
        }
        action={
          <IconButton
            aria-label="close"
            color="inherit"
            onClick={handleClose}
            size="small"
          >
            <Close className={classes.icon} />
          </IconButton>
        }
      />
    </StyledSnackbar>
  );
});
