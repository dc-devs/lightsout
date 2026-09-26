import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Theme } from '#src/common/constants/Theme.ts';
import { ThemeProvider } from '#src/theme/ThemeProvider.tsx';
import { useTheme } from '#src/theme/useTheme.ts';

const ThemeReadout = () => {
	const { theme } = useTheme();

	return <p>theme: {theme}</p>;
};

const setupUseTheme = () => {
	localStorage.clear();
	render(
		<ThemeProvider defaultTheme={Theme.Light}>
			<ThemeReadout />
		</ThemeProvider>,
	);
};

/** The same reader with no provider above it — the mistake the hook exists to name. */
const setupUnwrappedReader = () => {
	localStorage.clear();

	return { renderReadout: () => render(<ThemeReadout />) };
};

describe('useTheme', () => {
	test('hands back the theme in force', () => {
		setupUseTheme();

		const readout = screen.getByText('theme: light');

		expect(readout).toBeInTheDocument();
	});

	test('says so rather than handing back a silently wrong theme outside a provider', () => {
		const { renderReadout } = setupUnwrappedReader();

		expect(renderReadout).toThrow('useTheme must be used within a ThemeProvider');
	});
});
