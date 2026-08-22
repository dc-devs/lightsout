import { useContext } from 'react';
import type { ThemeContextValue } from '#src/theme/common/types/ThemeContextValue.ts';
import { ThemeContext } from '#src/theme/ThemeContext.ts';

/**
 * The current theme preference, what it resolved to, and the way to change it.
 *
 * @throws {Error} When called outside a `ThemeProvider`.
 */
export const useTheme = (): ThemeContextValue => {
	const value = useContext(ThemeContext);

	if (value === null) {
		throw new Error('useTheme must be used within a ThemeProvider');
	}

	return value;
};
