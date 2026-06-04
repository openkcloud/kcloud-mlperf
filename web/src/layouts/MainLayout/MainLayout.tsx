import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { Box, Drawer, IconButton, Tooltip, Typography, useMediaQuery, useTheme, styled } from '@mui/material';
import {
  Menu as MenuIcon,
  Close as CloseIcon,
  DarkModeOutlined as DarkIcon,
  LightModeOutlined as LightIcon,
  ArticleOutlined as ArticleIcon,
} from '@mui/icons-material';
import _clsx from 'clsx';

import { useColorMode } from '@/contexts/ThemeContext/ThemeContext';

import ChevronRightSVG from '@/assets/icons/chevron-right.svg?react';
import CloudSVG from '@/assets/icons/cloud.svg?react';
import HexagonSVG from '@/assets/icons/hexagon.svg?react';
import { AppLoader } from '@/components/AppLoader';
import { RenderErrorBoundary } from '@/components/ErrorBoundary';

import { DashboardPageLinks, HomePageLinks, MethodologyPageLinks, MmluPageLinks, MpExamPageLinks, NpuEvalPageLinks, NpuEvalRngdPageLinks, NpuEvalAtomPlusPageLinks } from '@/contexts/RouterContext/router.links.ts';

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

const BENCHMARK_NAV_ITEMS = [
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
    sublabel: 'Language understanding',
    Icon: HexagonSVG,
    segment: 'mmlu'
  },
  // Exactly one RNGD entry (new dedicated page; old /npu-eval is now a redirect target)
  {
    to: NpuEvalRngdPageLinks.main,
    label: 'RNGD NPU Eval',
    sublabel: 'FuriosaAI RNGD only',
    Icon: HexagonSVG,
    segment: 'npu-eval/rngd'
  },
  {
    to: NpuEvalAtomPlusPageLinks.main,
    label: 'Rebellions Atom+ NPU Eval',
    // node5 is joined and the Atom+ devices are live; the remaining gap is the
    // inference server (NodePort 30093 not yet deployed), not the device itself.
    sublabel: 'node5 · inference server pending',
    Icon: HexagonSVG,
    segment: 'npu-eval/atomplus'
  }
] as const;

const COMPARISON_NAV_ITEMS = [
  {
    to: MpExamPageLinks.deviceComparison,
    label: 'MLPerf vs NPU',
    sublabel: 'Cross-device comparison',
    Icon: HexagonSVG,
    segment: 'ml-perf/device-comparison'
  },
  {
    to: MmluPageLinks.deviceComparison,
    label: 'MMLU vs NPU',
    sublabel: 'Cross-device comparison',
    Icon: HexagonSVG,
    segment: 'mmlu/device-comparison'
  },
  {
    to: NpuEvalPageLinks.deviceComparison,
    label: 'NPU vs GPU',
    sublabel: 'Cross-device comparison',
    Icon: HexagonSVG,
    segment: 'npu-eval/device-comparison'
  }
] as const;

const OPERATIONS_NAV_ITEMS = [
  {
    to: DashboardPageLinks.gpuRealtime,
    label: 'GPU Realtime',
    sublabel: 'Live benchmark feed',
    Icon: CloudSVG,
    segment: 'dashboard/gpu-realtime'
  },
  {
    to: DashboardPageLinks.npuRealtime,
    label: 'NPU Realtime',
    sublabel: 'RNGD + Atom+ live feed',
    Icon: HexagonSVG,
    segment: 'dashboard/npu-realtime'
  }
] as const;

// ----------------------------------------------------------------------

const ThemeToggleButton = () => {
  const { mode, toggleColorMode } = useColorMode();
  return (
    <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} arrow>
      <IconButton
        onClick={toggleColorMode}
        size="small"
        aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        sx={{ color: 'rgba(148, 163, 184, 0.7)', '&:hover': { color: '#fff' } }}
      >
        {mode === 'dark' ? <LightIcon fontSize="small" /> : <DarkIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
};

type SidebarProps = {
  onClose?: () => void;
};

const Sidebar = ({ onClose }: SidebarProps) => (
  <SidebarContent>
    {/* Logo / Brand */}
    <Box sx={{ mb: 3.5, px: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Link
        to={HomePageLinks.main}
        aria-label="Go to home page"
        style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', cursor: 'pointer', borderRadius: '0.5rem', outline: 'none' }}
        onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px #818CF8'; }}
        onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
      >
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
      </Link>
      <Box sx={{ display: 'flex', alignItems: 'center', ml: 1 }}>
        <ThemeToggleButton />
        {onClose && (
          <IconButton
            onClick={onClose}
            size="small"
            sx={{ color: 'rgba(148, 163, 184, 0.6)', '&:hover': { color: '#fff' } }}
            aria-label="Close sidebar"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
    </Box>

    {/* Divider */}
    <Box sx={{ height: '1px', background: 'rgba(255,255,255,0.06)', mx: -0.5, mb: 2 }} />

    {/* Section: Benchmarks */}
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
    {BENCHMARK_NAV_ITEMS.map(({ to, label, sublabel, Icon }) => (
      <StyledNavLink key={to} to={to}>
        <Icon className="nav-icon" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.875rem', color: 'inherit', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </Typography>
          <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(148, 163, 184, 0.5)', fontWeight: 400, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sublabel}
          </Typography>
        </Box>
        <ChevronRightSVG className="nav-chevron" />
      </StyledNavLink>
    ))}

    {/* Section: Cross-device comparisons */}
    <Box sx={{ height: '1px', background: 'rgba(255,255,255,0.06)', mx: -0.5, mt: 1.5, mb: 1 }} />
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
      Cross-device comparisons
    </Typography>
    {COMPARISON_NAV_ITEMS.map(({ to, label, sublabel, Icon }) => (
      <StyledNavLink key={to} to={to}>
        <Icon className="nav-icon" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.875rem', color: 'inherit', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </Typography>
          <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(148, 163, 184, 0.5)', fontWeight: 400, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sublabel}
          </Typography>
        </Box>
        <ChevronRightSVG className="nav-chevron" />
      </StyledNavLink>
    ))}

    {/* Section: Operations */}
    <Box sx={{ height: '1px', background: 'rgba(255,255,255,0.06)', mx: -0.5, mt: 1.5, mb: 1 }} />
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
      Operations
    </Typography>
    {OPERATIONS_NAV_ITEMS.map(({ to, label, sublabel, Icon }) => (
      <StyledNavLink key={to} to={to}>
        <Icon className="nav-icon" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.875rem', color: 'inherit', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </Typography>
          <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(148, 163, 184, 0.5)', fontWeight: 400, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sublabel}
          </Typography>
        </Box>
        <ChevronRightSVG className="nav-chevron" />
      </StyledNavLink>
    ))}

    {/* Section: About */}
    <Box sx={{ height: '1px', background: 'rgba(255,255,255,0.06)', mx: -0.5, mt: 1.5, mb: 1 }} />
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
      About
    </Typography>
    <StyledNavLink to={MethodologyPageLinks.main}>
      <ArticleIcon className="nav-icon" />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, fontSize: '0.875rem', color: 'inherit', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Methodology
        </Typography>
        <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(148, 163, 184, 0.5)', fontWeight: 400, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Reproducibility disclosure
        </Typography>
      </Box>
      <ChevronRightSVG className="nav-chevron" />
    </StyledNavLink>

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

  // Top bar must track the active palette — a hardcoded white header floating
  // above the dark body/sidebar is the jarring "hideous in dark mode" defect.
  const isDark = theme.palette.mode === 'dark';
  const headerBg = isDark
    ? 'linear-gradient(90deg, #0F172A 0%, #172033 60%, #1E293B 100%)' // palette default→tableHead→paper
    : 'linear-gradient(90deg, #FFFFFF 0%, #FAFBFF 60%, #F5F7FF 100%)';
  const headerBorder = isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(226, 232, 240, 0.8)';
  const headerShadow = isDark ? '0 1px 0 rgba(0,0,0,0.3)' : '0 1px 4px rgba(15,23,42,0.04)';
  const titleColor = isDark ? '#F1F5F9' : '#0F172A';
  const menuColor = isDark ? '#94A3B8' : '#475569';

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
  const isNpuRngd = pathname.startsWith('/npu-eval/rngd');
  const isNpu = pathname.startsWith('/npu-eval');
  const isNpuRealtime = pathname.startsWith('/dashboard/npu-realtime');
  const isDashboard = pathname.startsWith('/dashboard');
  const isMlPerf = pathname.startsWith('/ml-perf');
  // The MLPerf benchmark page lives at /ml-perf; the cluster overview is the
  // bare "/" route. Without an explicit MLPerf check the overview fell through
  // to the "MLPerf Benchmark" title, which was wrong for the landing page.
  const pageTitle = isNpuRngd
    ? 'RNGD NPU Evaluation'
    : isNpu
      ? 'NPU Evaluation'
      : isMMlu
        ? 'MMLU-Pro Benchmark'
        : isNpuRealtime
          ? 'NPU Realtime Dashboard'
          : isDashboard
            ? 'GPU Realtime Dashboard'
            : isMlPerf
              ? 'MLPerf Benchmark'
              : 'Cluster Overview';
  const pageBadge = isNpuRngd
    ? 'FuriosaAI RNGD'
    : isNpu
      ? 'FuriosaAI RNGD'
      : isMMlu
        ? 'MMLU-Pro'
        : isNpuRealtime
          ? 'Live'
          : isDashboard
            ? 'Live'
            : isMlPerf
              ? 'MLPerf v5.1'
              : 'Overview';

  return (
    <StyledWrapper>
      {/* Skip-to-main-content link — visually hidden until focused (F13) */}
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: 'fixed',
          top: '-999px',
          left: '1rem',
          zIndex: 9999,
          px: 2,
          py: 1,
          bgcolor: '#4F46E5',
          color: '#FFF',
          fontWeight: 700,
          borderRadius: '0 0 0.5rem 0.5rem',
          textDecoration: 'none',
          fontSize: '0.875rem',
          '&:focus': {
            top: 0
          }
        }}
      >
        Skip to main content
      </Box>

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
            borderBottom: `1px solid ${headerBorder}`,
            background: headerBg,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            position: 'sticky',
            top: 0,
            zIndex: 5,
            boxShadow: headerShadow
          }}
        >
          {/* Mobile menu button */}
          {isMobile && (
            <IconButton
              onClick={() => setMobileOpen(true)}
              size="small"
              sx={{ color: menuColor, mr: 0.5 }}
              aria-label="Open navigation"
            >
              <MenuIcon />
            </IconButton>
          )}

          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* h2, not h1: each page body owns its single <h1> (e.g. the home
                hero). A second top-bar h1 duplicated the page heading and broke
                one-h1-per-page a11y. */}
            <Typography
              variant="h5"
              component="h2"
              sx={{
                fontWeight: 700,
                color: titleColor,
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
              background: isNpu
                ? `linear-gradient(135deg, rgba(249,115,22,${isDark ? 0.18 : 0.08}) 0%, rgba(251,146,60,${isDark ? 0.12 : 0.06}) 100%)`
                : `linear-gradient(135deg, rgba(99,102,241,${isDark ? 0.22 : 0.08}) 0%, rgba(129,140,248,${isDark ? 0.14 : 0.06}) 100%)`,
              border: isNpu
                ? `1px solid rgba(249,115,22,${isDark ? 0.4 : 0.25})`
                : `1px solid rgba(129,140,248,${isDark ? 0.4 : 0.18})`,
              flexShrink: 0
            }}
          >
            <Typography
              sx={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: isNpu ? (isDark ? '#FDBA74' : '#F97316') : (isDark ? '#A5B4FC' : '#4F46E5'),
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
          id="main-content"
          ref={containerRef}
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            p: { xs: 2, sm: 2.5, md: 3 }
          }}
        >
          <Suspense fallback={<AppLoader />}>
            <RenderErrorBoundary>{children}</RenderErrorBoundary>
          </Suspense>
        </Box>
      </Box>
    </StyledWrapper>
  );
};
