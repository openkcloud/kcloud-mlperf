import type { Theme } from '@emotion/react';
import { Fragment, type ReactNode, forwardRef } from 'react';

import { Autocomplete, Box, InputLabel, type SxProps, TextField } from '@mui/material';

import { RefreshButton } from '@/components/RefreshButton';

// ----------------------------------------------------------------------

type ValueType = { label: string; value: string | number };

type SelectMenuProps = {
  name: string;
  label?: string;
  inputLabel: string;
  size?: 'small' | 'medium';
  required?: boolean;
  options: Array<{ label: string; value: string | number }>;
  hasError?: boolean;
  helperText?: ReactNode;
  value: ValueType;
  onChange: (value: ValueType | null) => void;
  labelSx?: SxProps<Theme>;
  textFieldSx?: SxProps<Theme>;
  refreshBtn?: {
    onClick: () => Promise<any>;
  };
};

// ----------------------------------------------------------------------

export const SelectMenu = forwardRef<HTMLElement, SelectMenuProps>((props, ref) => {
  const {
    name,
    label,
    inputLabel,
    required,
    options,
    value,
    onChange,
    hasError,
    helperText,
    size = 'medium',
    labelSx = {},
    textFieldSx = {},
    refreshBtn
  } = props;

  return (
    <Fragment>
      {label && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            minHeight: '2.5rem'
          }}
        >
          <InputLabel
            htmlFor={name}
            sx={{
              paddingBottom: '0.5rem',
              fontWeight: 500,
              ...labelSx
            }}
          >
            {label}
          </InputLabel>
          {refreshBtn && <RefreshButton {...refreshBtn} />}
        </Box>
      )}
      <Autocomplete
        ref={ref}
        id={name}
        value={value}
        onChange={(_, newValue) => onChange(newValue)}
        options={options}
        getOptionLabel={option => option.label}
        autoHighlight
        isOptionEqualToValue={(option, value) => option.value === value?.value}
        renderInput={params => (
          <TextField
            {...params}
            label={inputLabel}
            error={hasError}
            helperText={hasError ? helperText : ''}
            size={size}
            aria-required={required}
            required={required}
            sx={{
              '& .MuiInputBase-root': {
                backgroundColor: 'white'
              },
              '& .MuiOutlinedInput-root': {
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#A5B4FC'
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#4F46E5',
                  borderWidth: '2px'
                }
              },
              '& .MuiInputLabel-root.Mui-focused': {
                color: '#4F46E5'
              },
              ...textFieldSx
            }}
          />
        )}
      />
    </Fragment>
  );
});
