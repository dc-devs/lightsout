import { type LucideIcon, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '#src/appUI/Button.tsx';
import { Theme } from '#src/common/constants/Theme.ts';
import { useTheme } from '#src/theme/index.ts';

/** Light, then dark, then follow the system — one control cycling three states rather than three. */
const nextTheme: Record<Theme, Theme> = {
	[Theme.Light]: Theme.Dark,
	[Theme.Dark]: Theme.System,
	[Theme.System]: Theme.Light,
};

const themeLabels: Record<Theme, string> = {
	[Theme.Light]: 'light theme',
	[Theme.Dark]: 'dark theme',
	[Theme.System]: 'system theme',
};

const themeIcons: Record<Theme, LucideIcon> = {
	[Theme.Light]: Sun,
	[Theme.Dark]: Moon,
	[Theme.System]: Monitor,
};

/**
 * Cycles the theme preference.
 *
 * The icon says which preference is in force; the accessible name says which
 * one the next press selects, because a control whose name is its current state
 * gives a screen-reader user no way to know what pressing it does.
 */
export const ThemeToggle = () => {
	const { theme, setTheme } = useTheme();
	const next = nextTheme[theme];
	const Icon = themeIcons[theme];

	return (
		<Button type="button" variant="ghost" size="icon" aria-label={`Switch to ${themeLabels[next]}`} onClick={() => setTheme(next)}>
			<Icon className="size-4" />
		</Button>
	);
};
