import { describe, expect, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from '#src/appUI/buttons/ThemeToggle.tsx';
import { Theme } from '#src/common/constants/Theme.ts';
import { ThemeProvider } from '#src/theme/index.ts';

const setupThemeToggle = ({ defaultTheme = Theme.Dark }: { defaultTheme?: Theme } = {}) => {
	// The provider reads a stored choice on mount, and jsdom keeps one store for
	// the whole file — so an earlier test's choice would decide a later test's
	// starting point.
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
		{ defaultTheme: Theme.Dark, next: 'Switch to light theme' },
	])('names the theme a press selects rather than the one in force', ({ defaultTheme, next }) => {
		setupThemeToggle({ defaultTheme });

		expect(screen.getByRole('button', { name: next })).toBeInTheDocument();
	});

	test('switches to dark and back again, with no third stop', () => {
		setupThemeToggle({ defaultTheme: Theme.Light });

		fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
		fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));

		expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
	});

	test.each([
		{ defaultTheme: Theme.Light, icon: 'lucide-sun' },
		{ defaultTheme: Theme.Dark, icon: 'lucide-moon' },
	])('shows the one icon standing for the theme in force', ({ defaultTheme, icon }) => {
		const { container } = setupThemeToggle({ defaultTheme });

		const icons = container.querySelectorAll('svg');

		expect(icons).toHaveLength(1);
		expect(icons[0]?.getAttribute('class')).toContain(icon);
	});
});
