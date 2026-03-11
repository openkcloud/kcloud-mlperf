import { memo, useEffect, useState } from 'react';

import SearchIcon from '@mui/icons-material/Search';
import { Box, InputAdornment, TextField } from '@mui/material';

interface TableSearchInputProps {
  onSearch?: (searchTerm: string) => void;
  debounceMs?: number;
}

export const TableSearchInput = memo(({ onSearch, debounceMs = 500 }: TableSearchInputProps) => {
  const [value, setValue] = useState<string>('');

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch?.(value);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [value, debounceMs, onSearch]);

  return (
    <Box>
      <TextField
        name="tableSearch"
        value={value}
        label="Search"
        placeholder="Name, model, dataset, GPU, or 'Best'"
        onChange={event => setValue(event.target.value)}
        size="small"
        variant="outlined"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon
                  sx={{
                    fontSize: '1.125rem',
                    color: value ? '#4F46E5' : 'grey.400',
                    transition: 'color 0.2s ease'
                  }}
                />
              </InputAdornment>
            )
          }
        }}
        sx={{
          width: '18rem',
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
          '& input::placeholder': {
            color: 'grey.400',
            opacity: 1,
            fontSize: '0.875rem'
          }
        }}
      />
    </Box>
  );
});
