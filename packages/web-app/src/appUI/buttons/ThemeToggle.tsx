import { Moon, Sun } from 'lucide-react';
import { Button } from '#src/appUI/buttons/Button.tsx';
import { Theme } from '#src/common/constants/Theme.ts';
import { useTheme } from '#src/theme/useTheme.ts';

/**
 * Switches between light and dark.
 *
 * The icon says which theme is in force; the accessible name says which one a
 * press selects, because a control whose name is its current state gives a
 * screen-reader user no way to know what pressing it does.
 */
export const ThemeToggle = () => {
	const { theme, setTheme } = useTheme();
	const isDark = theme === Theme.Dark;
	const Icon = isDark ? Moon : Sun;

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
			onClick={() => setTheme(isDark ? Theme.Light : Theme.Dark)}
		>
			<Icon className="size-4" />
		</Button>
	);
};
