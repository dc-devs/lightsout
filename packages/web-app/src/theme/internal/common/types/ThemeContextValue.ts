import type { ResolvedTheme } from '#src/common/constants/ResolvedTheme.ts';
import type { Theme } from '#src/common/constants/Theme.ts';

/**
 * What the provider hands down: what the viewer asked for, what that resolved
 * to, and the way to change it.
 *
 * Declared once so the context and `useTheme`'s return annotation are the same
 * contract rather than two copies of a shape that can drift apart.
 */
export interface ThemeContextValue {
	theme: Theme;
	resolvedTheme: ResolvedTheme;
	setTheme: (theme: Theme) => void;
}
