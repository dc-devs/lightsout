import { createContext } from 'react';
import type { ThemeContextValue } from '#src/theme/common/types/ThemeContextValue.ts';

/** Null outside a provider, which is what lets `useTheme` say so rather than hand back a silently wrong theme. */
export const ThemeContext = createContext<ThemeContextValue | null>(null);
