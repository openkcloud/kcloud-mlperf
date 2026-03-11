import DownloadIcon from '@mui/icons-material/Download';
import { Button } from '@mui/material';

export const DownloadButton = (props: { url: string; label: string }) => {
  const { url, label } = props;

  return (
    <Button
      variant="contained"
      startIcon={<DownloadIcon sx={{ fontSize: '1rem' }} />}
      href={url}
      download
      size="small"
      sx={{
        background: 'linear-gradient(135deg, #4F46E5 0%, #0EA5E9 100%)',
        boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
        fontWeight: 600,
        fontSize: '0.8125rem',
        letterSpacing: '0.01em',
        textTransform: 'none',
        borderRadius: '0.5rem',
        px: 2,
        py: 0.75,
        '&:hover': {
          background: 'linear-gradient(135deg, #4338CA 0%, #0284C7 100%)',
          boxShadow: '0 4px 12px rgba(79, 70, 229, 0.4)',
          transform: 'translateY(-1px)',
          transition: 'all 200ms ease'
        },
        transition: 'all 200ms ease'
      }}
    >
      {label}
    </Button>
  );
};
