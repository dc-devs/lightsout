import { describe, expect, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from '#src/appUI/ThemeToggle.tsx';
import { Theme } from '#src/common/constants/Theme.ts';
import { ThemeProvider } from '#src/theme/index.ts';

const setupThemeToggle = ({ defaultTheme = Theme.Dark }: { defaultTheme?: Theme } = {}) => {
	// The provider reads a stored preference on mount, and jsdom keeps one
	// store for the whole file — so an earlier test's choice would decide a
	// later test's starting point.
	localStorage.clear();
	const { container } = render(
		<ThemeProvider defaultTheme={defaultTheme}>
			<ThemeToggle />
		</ThemeProvider>,
	);

	return { container };
};

describe('ThemeToggle', () => {
	test.each([
		{ defaultTheme: Theme.Light, next: 'Switch to dark theme' },
		{ defaultTheme: Theme.Dark, next: 'Switch to system theme' },
		{ defaultTheme: Theme.System, next: 'Switch to light theme' },
	])('names the theme the next press selects rather than the one in force', ({ defaultTheme, next }) => {
		setupThemeToggle({ defaultTheme });

		const toggle = screen.getByRole('button', { name: next });

		expect(toggle).toBeInTheDocument();
	});

	test('moves the preference on when pressed', () => {
		setupThemeToggle({ defaultTheme: Theme.Light });

		fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
		const toggle = screen.getByRole('button', { name: 'Switch to system theme' });

		expect(toggle).toBeInTheDocument();
	});

	test('cycles back round to light from following the system', () => {
		setupThemeToggle({ defaultTheme: Theme.System });

		fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
		const toggle = screen.getByRole('button', { name: 'Switch to dark theme' });

		expect(toggle).toBeInTheDocument();
	});

	test.each([
		{ defaultTheme: Theme.Light, icon: 'lucide-sun' },
		{ defaultTheme: Theme.Dark, icon: 'lucide-moon' },
		{ defaultTheme: Theme.System, icon: 'lucide-monitor' },
	])('shows the one icon standing for the preference in force', ({ defaultTheme, icon }) => {
		const { container } = setupThemeToggle({ defaultTheme });

		const icons = container.querySelectorAll('svg');

		expect(icons).toHaveLength(1);
		expect(icons[0]?.getAttribute('class')).toContain(icon);
	});
});
