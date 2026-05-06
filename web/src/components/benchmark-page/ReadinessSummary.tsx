import { Alert, AlertTitle, Box, Divider, Link, Typography } from '@mui/material';
import { CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import type { SvgIconComponent } from '@mui/icons-material';

export type ReadinessItem = {
  Icon: SvgIconComponent;
  title: string;
  detail: string;
};

type Props = {
  title: string;
  summary: string;
  items: readonly ReadinessItem[];
  footerText?: string;
  footerLinkLabel?: string;
  footerLinkHref?: string;
};

export const ReadinessSummary = ({ title, summary, items, footerText, footerLinkLabel, footerLinkHref }: Props) => (
  <Alert
    severity="success"
    icon={<CheckCircleIcon />}
    sx={{
      mb: 3,
      border: '1px solid rgba(22,163,74,0.4)',
      bgcolor: 'rgba(240,253,244,0.8)',
      '& .MuiAlert-icon': { color: '#15803D' },
    }}
  >
    <AlertTitle sx={{ fontWeight: 700, color: '#14532D', fontSize: '1rem' }}>{title}</AlertTitle>
    <Typography variant="body2" sx={{ color: '#166534', mb: 2 }}>
      {summary}
    </Typography>

    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map(({ Icon, title: itemTitle, detail }, idx) => (
        <Box key={itemTitle} sx={{ display: 'flex', gap: 1.5 }}>
          <Box
            sx={{
              mt: 0.25,
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: 'rgba(22,163,74,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Typography sx={{ fontWeight: 800, fontSize: '0.75rem', color: '#14532D' }}>{idx + 1}</Typography>
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
              <Icon sx={{ fontSize: 16, color: '#15803D' }} />
              <Typography variant="body2" fontWeight={700} sx={{ color: '#14532D' }}>
                {itemTitle}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: '#166534', lineHeight: 1.5 }}>
              {detail}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>

    {(footerText || footerLinkLabel) && (
      <>
        <Divider sx={{ my: 2, borderColor: 'rgba(22,163,74,0.3)' }} />
        <Typography variant="caption" sx={{ color: '#166534' }}>
          {footerText}{' '}
          {footerLinkLabel && footerLinkHref && (
            <Link href={footerLinkHref} target="_blank" rel="noopener noreferrer" sx={{ color: '#15803D', fontWeight: 600 }}>
              {footerLinkLabel}
            </Link>
          )}
        </Typography>
      </>
    )}
  </Alert>
);
