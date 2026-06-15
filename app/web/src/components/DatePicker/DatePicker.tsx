import { Fragment, type ReactNode } from 'react';

import { InputLabel, type SxProps, type Theme } from '@mui/material';
import {
  DateTimePicker,
  type DateTimeValidationError,
  LocalizationProvider,
  type PickerChangeHandlerContext
} from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import type { PickerValue } from '@mui/x-date-pickers/internals';
import type { Dayjs } from 'dayjs';

import { TIMEZONE } from '@/constants/timezone.constants.ts';

// ----------------------------------------------------------------------

type DatePickerProps = {
  name: string;
  label: string;
  required?: boolean;
  format?: string;
  sx?: SxProps<Theme>;
  inputLabel: string;
  value: Dayjs;
  hasError?: boolean;
  helperText?: ReactNode;
  onChange: (
    value: PickerValue,
    context: PickerChangeHandlerContext<DateTimeValidationError>
  ) => void;
};

// ----------------------------------------------------------------------

export const DatePicker = (props: DatePickerProps) => {
  const {
    name,
    label,
    required,
    sx,
    inputLabel,
    value,
    onChange,
    hasError,
    helperText,
    format = 'DD/MM/YYYY HH:mm'
  } = props;

  return (
    <Fragment>
      <InputLabel
        htmlFor={name}
        sx={{
          marginBottom: '0.75rem',
          fontWeight: 500
        }}
      >
        {label}
      </InputLabel>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DateTimePicker
          name={name}
          label={inputLabel}
          value={value}
          onChange={onChange}
          format={format}
          timezone={TIMEZONE}
          aria-required={required}
          slotProps={{
            textField: {
              error: hasError,
              helperText,
              sx: {
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
                }
              }
            },
            openPickerButton: {
              sx: {
                color: 'grey.500',
                '&:hover': {
                  color: '#4F46E5',
                  backgroundColor: '#EEF2FF'
                }
              }
            }
          }}
          sx={{
            '& .MuiPickersInputBase-root': {
              backgroundColor: 'white'
            },
            ...sx
          }}
        />
      </LocalizationProvider>
    </Fragment>
  );
};
