import { useState, type MouseEvent } from 'react';
import {
  Button,
  Menu,
  MenuItem,
  Checkbox,
  ListItemText,
  ListItemIcon,
} from '@mui/material';
import { ViewColumn as ViewColumnIcon } from '@mui/icons-material';

// ----------------------------------------------------------------------
// Column-visibility control (R10): a button that opens a Menu of checkboxes,
// one per toggleable column. Pairs with `useColumnVisibility`. Columns are
// described by a key (the visibility map key) and a human label.
// ----------------------------------------------------------------------

export type ColumnOption = { key: string; label: string };

type Props = {
  columns: ColumnOption[];
  isVisible: (key: string) => boolean;
  onToggle: (key: string) => void;
  /** Accessible label / button text. */
  label?: string;
};

export const ColumnMenu = ({ columns, isVisible, onToggle, label = 'Columns' }: Props) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (e: MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<ViewColumnIcon fontSize="small" />}
        onClick={handleOpen}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${label} — choose visible columns`}
        sx={{ color: 'text.secondary', borderColor: 'divider' }}
      >
        {label}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {columns.map(col => {
          const checked = isVisible(col.key);
          return (
            <MenuItem
              key={col.key}
              dense
              onClick={() => onToggle(col.key)}
              sx={{ pl: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 0 }}>
                <Checkbox
                  edge="start"
                  size="small"
                  checked={checked}
                  tabIndex={-1}
                  disableRipple
                  inputProps={{ 'aria-label': `Toggle ${col.label} column` }}
                />
              </ListItemIcon>
              <ListItemText primary={col.label} primaryTypographyProps={{ variant: 'body2' }} />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
};

export default ColumnMenu;
