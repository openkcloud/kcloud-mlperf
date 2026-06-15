import { type ChangeEventHandler, Fragment, forwardRef } from 'react';

import { InputLabel } from '@mui/material';

// ----------------------------------------------------------------------

type TextAreaProps = {
  style?: React.CSSProperties;
  label?: string;
  placeholder?: string;
  name: string;
  minRows?: number;
  required?: boolean;
  value: string;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onBlur?: VoidFunction;
  disabled?: boolean;
};

// ----------------------------------------------------------------------

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>((props, ref) => {
  const {
    name,
    label,
    placeholder,
    required,
    onChange,
    onBlur,
    value,
    disabled,
    style = {},
    minRows = 3
  } = props;

  const rowHeight = 1.5 * 16; // 1.5rem line-height in px
  const minHeight = minRows * rowHeight + 24; // 24px for padding

  return (
    <Fragment>
      {label && (
        <InputLabel
          htmlFor={name}
          sx={{
            marginBottom: '0.75rem',
            fontWeight: 500
          }}
        >
          {label}
        </InputLabel>
      )}
      <textarea
        aria-required={required}
        ref={ref}
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        aria-label="text area"
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        style={{
          width: '100%',
          minHeight: `${minHeight}px`,
          padding: '0.625rem 0.875rem',
          fontSize: '1rem',
          lineHeight: 1.5,
          fontFamily: 'inherit',
          color: '#111827',
          backgroundColor: disabled ? '#F9FAFB' : 'white',
          border: '1px solid #D1D5DB',
          borderRadius: '0.5rem',
          outline: 'none',
          resize: 'vertical',
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          boxSizing: 'border-box',
          ...style
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = '#4F46E5';
          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79, 70, 229, 0.12)';
        }}
        onBlurCapture={e => {
          e.currentTarget.style.borderColor = '#D1D5DB';
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
    </Fragment>
  );
});
