import { createTheme } from '@mui/material';

import { palette } from '@/contexts/ThemeContext/theme.palette';

export const theme = createTheme({
  palette,
  shape: {
    borderRadius: '0.625rem'
  },
  typography: {
    fontFamily: '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h1: {
      fontWeight: 700,
      letterSpacing: '-0.025em'
    },
    h2: {
      fontWeight: 600,
      letterSpacing: '-0.025em'
    },
    h3: {
      fontWeight: 600,
      letterSpacing: '-0.02em'
    },
    subtitle1: {
      fontWeight: 500
    },
    subtitle2: {
      fontWeight: 500
    },
    body1: {
      lineHeight: 1.6
    },
    body2: {
      lineHeight: 1.5
    },
    button: {
      fontWeight: 600,
      textTransform: 'none',
      letterSpacing: '0.01em'
    }
  },
  shadows: [
    'none',
    '0 1px 2px 0 rgba(0,0,0,0.05)',
    '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
    '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
    '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
    '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)',
    '0 25px 50px -12px rgba(0,0,0,0.25)'
  ],
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#F8FAFC'
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: '0.5rem',
          padding: '0.5rem 1.25rem',
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)'
          }
        },
        contained: {
          background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #4338CA 0%, #4F46E5 100%)'
          }
        },
        outlined: {
          borderColor: '#E2E8F0',
          color: '#475569',
          '&:hover': {
            borderColor: '#4F46E5',
            backgroundColor: 'rgba(79, 70, 229, 0.04)'
          }
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none'
        }
      }
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: '#FFFFFF',
            transition: 'all 0.2s ease',
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: '#818CF8'
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: '#4F46E5',
              borderWidth: '2px'
            }
          },
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: '#E2E8F0'
          }
        }
      }
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: '#334155',
          fontWeight: 500,
          fontSize: '0.875rem'
        }
      }
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            fontWeight: 600,
            color: '#334155',
            backgroundColor: '#F1F5F9',
            borderBottom: '2px solid #E2E8F0',
            fontSize: '0.8125rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }
        }
      }
    },
    MuiTableBody: {
      styleOverrides: {
        root: {
          '& .MuiTableRow-root': {
            transition: 'background-color 0.15s ease',
            '&:hover': {
              backgroundColor: '#F8FAFC'
            }
          },
          '& .MuiTableCell-root': {
            borderBottom: '1px solid #F1F5F9',
            color: '#475569',
            fontSize: '0.875rem'
          }
        }
      }
    },
    MuiAutocomplete: {
      styleOverrides: {
        paper: {
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
          border: '1px solid #E2E8F0',
          borderRadius: '0.5rem'
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          borderRadius: '0.375rem'
        }
      }
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          '&::before': { display: 'none' },
          borderRadius: '0.75rem !important'
        }
      }
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          borderRadius: '0.75rem',
          '&.Mui-expanded': {
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0
          }
        }
      }
    }
  }
});
