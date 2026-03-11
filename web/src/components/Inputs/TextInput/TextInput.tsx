import {
  type ChangeEventHandler,
  Fragment,
  type ReactNode,
  type WheelEvent,
  forwardRef
} from 'react';

import { InputLabel, type SxProps, TextField, type Theme } from '@mui/material';

// ----------------------------------------------------------------------

type TextInputProps = {
  label?: string;
  inputLabel?: string;
  size?: 'small' | 'medium';
  name?: string;
  variant?: 'filled' | 'outlined' | 'standard';
  sx?: SxProps<Theme>;
  inputLabelSx?: SxProps<Theme>;
  type?: React.InputHTMLAttributes<unknown>['type'];
  required?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  hasError?: boolean;
  helperText?: ReactNode;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onBlur?: VoidFunction;
  value?: string | number;
};

// ----------------------------------------------------------------------

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>((props, ref) => {
  const {
    label,
    inputLabel,
    size,
    name,
    sx,
    required,
    disabled,
    hasError,
    helperText,
    onChange,
    value,
    onBlur,
    fullWidth = true,
    variant = 'outlined',
    type = 'text',
    inputLabelSx = {}
  } = props;

  return (
    <Fragment>
      {label && (
        <InputLabel
          htmlFor={name}
          sx={{
            marginBottom: '0.75rem',
            fontWeight: 500,
            ...inputLabelSx
          }}
        >
          {label}
        </InputLabel>
      )}
      <TextField
        ref={ref}
        id={name}
        name={name}
        label={inputLabel}
        variant={variant}
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
          ...sx
        }}
        type={type}
        size={size}
        error={hasError}
        fullWidth={fullWidth}
        disabled={disabled}
        onChange={onChange}
        onBlur={onBlur}
        value={value}
        helperText={hasError ? helperText : ''}
        slotProps={{
          htmlInput: {
            onWheel: (e: WheelEvent<HTMLInputElement>) => e.currentTarget.blur(),
            inputMode: type === 'number' ? 'decimal' : 'text'
          }
        }}
        aria-required={required}
        required={required}
      />
    </Fragment>
  );
});
