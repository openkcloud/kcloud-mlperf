import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { Box, Drawer, IconButton, Typography, useMediaQuery, useTheme, styled } from '@mui/material';
import { Menu as MenuIcon, Close as CloseIcon } from '@mui/icons-material';
import clsx from 'clsx';

import ChevronRightSVG from '@/assets/icons/chevron-right.svg?react';
import CloudSVG from '@/assets/icons/cloud.svg?react';
import HexagonSVG from '@/assets/icons/hexagon.svg?react';
import { AppLoader } from '@/components/AppLoader';

import { MmluPageLinks, MpExamPageLinks } from '@/contexts/RouterContext/router.links.ts';

// ----------------------------------------------------------------------

const SIDEBAR_WIDTH = 272;

const StyledWrapper = styled('main')`
  display: flex;
  min-height: 100vh;
`;

const SidebarContent = styled('div')`
  width: ${SIDEBAR_WIDTH}px;
  background: linear-gradient(180deg, #0B1221 0%, #0F172A 40%, #1E293B 100%);
  padding: 1.75rem 1rem;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`;

const StyledNavLink = styled(NavLink)(() => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  color: 'rgba(148, 163, 184, 0.75)',
  padding: '0.75rem 0.875rem',
  borderRadius: '0.625rem',
  backgroundColor: 'transparent',
  width: '100%',
  marginBottom: '0.25rem',
  transition: 'color 180ms ease, background-color 180ms ease, border-color 180ms ease',
  textDecoration: 'none',
  border: '1px solid transparent',

  '& .nav-icon': {
    width: '20px',
    height: '20px',
    flexShrink: 0,
    opacity: 0.55,
    transition: 'opacity 180ms ease, color 180ms ease',
    color: 'rgba(148, 163, 184, 0.75)'
  },

  '& .nav-chevron': {
    position: 'absolute',
    right: '0.75rem',
    opacity: 0,
    transition: 'opacity 180ms ease, transform 180ms ease',
    width: '16px',
    height: '16px',
    color: '#818CF8'
  },

  '&:hover': {
    color: 'rgba(255, 255, 255, 0.9)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.06)',

    '& .nav-icon': {
      opacity: 0.85
    },

    '& .nav-chevron': {
      opacity: 0.5
    }
  },

  '&.active': {
    color: '#FFFFFF',
    background: 'linear-gradient(135deg, rgba(79,70,229,0.28) 0%, rgba(99,102,241,0.18) 100%)',
    borderColor: 'rgba(99, 102, 241, 0.45)',
    boxShadow: 'inset 0 0 0 1px rgba(99,102,241,0.12), 0 2px 8px rgba(79,70,229,0.15)',

    '& .nav-icon': {
      opacity: 1,
      color: '#A5B4FC'
    },

    '& .nav-chevron': {
      opacity: 1,
      transform: 'translateX(2px)'
    }
  }
}));

// ----------------------------------------------------------------------

const NAV_ITEMS = [
  {
    to: MpExamPageLinks.main,
    label: 'MLPerf',
    sublabel: 'MLPerf v5.1',
    Icon: CloudSVG,
    segment: 'ml-perf'
  },
  {
    to: MmluPageLinks.main,
    label: 'MMLU-Pro',
    sublabel: 'Language Understanding',
    Icon: HexagonSVG,
    segment: 'mmlu'
  }
] as const;

// ----------------------------------------------------------------------

type SidebarProps = {
  onClose?: () => void;
};

const Sidebar = ({ onClose }: SidebarProps) => (
  <SidebarContent>
    {/* Logo / Brand */}
    <Box sx={{ mb: 3.5, px: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: '0.5rem',
            background: 'linear-gradient(135deg, #005BAC 0%, #0078D4 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(0, 91, 172, 0.45)',
            flexShrink: 0
          }}
        >
          <Typography sx={{ color: '#FFF', fontWeight: 800, fontSize: '0.8125rem', letterSpacing: '-0.02em' }}>
            ET
          </Typography>
        </Box>
        <Box>
          <Typography
            sx={{
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '1.0625rem',
              letterSpacing: '-0.025em',
              lineHeight: 1.2
            }}
          >
            ETRI
          </Typography>
          <Typography
            sx={{
              color: 'rgba(148, 163, 184, 0.65)',
              fontSize: '0.6875rem',
              fontWeight: 400,
              letterSpacing: '0.01em',
              lineHeight: 1.3
            }}
          >
            LLM Benchmark Suite
          </Typography>
        </Box>
      </Box>
      {onClose && (
        <IconButton
          onClick={onClose}
          size="small"
          sx={{ color: 'rgba(148, 163, 184, 0.6)', ml: 1, '&:hover': { color: '#fff' } }}
          aria-label="Close sidebar"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      )}
    </Box>

    {/* Divider */}
    <Box sx={{ height: '1px', background: 'rgba(255,255,255,0.06)', mx: -0.5, mb: 2 }} />

    {/* Section Label */}
    <Typography
      sx={{
        color: 'rgba(148, 163, 184, 0.4)',
        fontSize: '0.625rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        px: 0.5,
        mb: 1.25
      }}
    >
      Benchmarks
    </Typography>

    {/* Nav Links */}
    {NAV_ITEMS.map(({ to, label, sublabel, Icon }) => (
      <StyledNavLink key={to} to={to}>
        <Icon className="nav-icon" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: '0.875rem',
              color: 'inherit',
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {label}
          </Typography>
          <Typography
            sx={{
              fontSize: '0.6875rem',
              color: 'rgba(148, 163, 184, 0.5)',
              fontWeight: 400,
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {sublabel}
          </Typography>
        </Box>
        <ChevronRightSVG className="nav-chevron" />
      </StyledNavLink>
    ))}

    {/* Spacer */}
    <Box sx={{ flex: 1 }} />

    {/* Footer */}
    <Box
      sx={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        pt: 2,
        px: 0.5
      }}
    >
      <Typography
        sx={{
          color: 'rgba(148, 163, 184, 0.35)',
          fontSize: '0.6875rem',
          fontWeight: 400,
          mb: 0.5
        }}
      >
        Model Performance Evaluation
      </Typography>
      <Typography
        sx={{
          color: 'rgba(148, 163, 184, 0.25)',
          fontSize: '0.625rem',
          fontWeight: 400
        }}
      >
        &copy; {new Date().getFullYear()} ETRI. All rights reserved.
      </Typography>
    </Box>
  </SidebarContent>
);

// ----------------------------------------------------------------------

type MainLayoutProps = {
  children: ReactNode;
};

// ----------------------------------------------------------------------

export const MainLayout = (props: MainLayoutProps) => {
  const { children } = props;

  const { pathname } = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pathname]);

  // Close drawer on route change (mobile)
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isMMlu = pathname.startsWith('/mmlu');
  const pageTitle = isMMlu ? 'MMLU-Pro Benchmark' : 'MLPerf Benchmark';
  const pageBadge = isMMlu ? 'MMLU-Pro' : 'MLPerf v5.1';

  return (
    <StyledWrapper>
      {/* Desktop sidebar */}
      {!isMobile && (
        <Box
          component="aside"
          sx={{
            width: SIDEBAR_WIDTH,
            minWidth: SIDEBAR_WIDTH,
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            zIndex: 10
          }}
        >
          <Sidebar />
        </Box>
      )}

      {/* Mobile drawer */}
      {isMobile && (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: SIDEBAR_WIDTH,
              border: 'none',
              boxShadow: '4px 0 24px rgba(0,0,0,0.4)'
            }
          }}
        >
          <Sidebar onClose={() => setMobileOpen(false)} />
        </Drawer>
      )}

      {/* Main Content */}
      <Box
        sx={{
          flex: 1,
          marginLeft: isMobile ? 0 : `${SIDEBAR_WIDTH}px`,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0
        }}
      >
        {/* Top bar */}
        <Box
          component="header"
          sx={{
            px: { xs: 2, sm: 3, md: 4 },
            py: { xs: 1.5, md: 2 },
            borderBottom: '1px solid rgba(226, 232, 240, 0.8)',
            background: 'linear-gradient(90deg, #FFFFFF 0%, #FAFBFF 60%, #F5F7FF 100%)',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            position: 'sticky',
            top: 0,
            zIndex: 5,
            boxShadow: '0 1px 4px rgba(15,23,42,0.04)'
          }}
        >
          {/* Mobile menu button */}
          {isMobile && (
            <IconButton
              onClick={() => setMobileOpen(true)}
              size="small"
              sx={{ color: '#475569', mr: 0.5 }}
              aria-label="Open navigation"
            >
              <MenuIcon />
            </IconButton>
          )}

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                color: '#0F172A',
                fontSize: { xs: '1rem', md: '1.1875rem' },
                letterSpacing: '-0.025em',
                lineHeight: 1.3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {pageTitle}
            </Typography>
          </Box>

          <Box
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: '9999px',
              background: 'linear-gradient(135deg, rgba(79,70,229,0.08) 0%, rgba(99,102,241,0.06) 100%)',
              border: '1px solid rgba(99,102,241,0.18)',
              flexShrink: 0
            }}
          >
            <Typography
              sx={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: '#4F46E5',
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap'
              }}
            >
              {pageBadge}
            </Typography>
          </Box>
        </Box>

        {/* Content area */}
        <Box
          ref={containerRef}
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            p: { xs: 2, sm: 2.5, md: 3 }
          }}
        >
          <Suspense fallback={<AppLoader />}>{children}</Suspense>
        </Box>
      </Box>
    </StyledWrapper>
  );
};
