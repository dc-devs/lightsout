import type { Theme } from '#src/common/constants/Theme.ts';

/**
 * What the provider hands down: the theme in force, and the way to change it.
 *
 * Declared once so the context and `useTheme`'s return annotation are the same
 * contract rather than two copies of a shape that can drift apart.
 */
export interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}
