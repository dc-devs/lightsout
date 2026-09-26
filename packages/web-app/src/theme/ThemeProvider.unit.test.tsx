import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { Theme } from '#src/common/constants/Theme.ts';
import { themeStorageKey } from '#src/common/constants/themeStorageKey.ts';
import { ThemeProvider } from '#src/theme/ThemeProvider.tsx';
import { useTheme } from '#src/theme/useTheme.ts';

/** A reader of the context that can also change it, so one render covers both halves. */
const ThemeControls = () => {
	const { theme, setTheme } = useTheme();

	return (
		<>
			<p>theme: {theme}</p>
			<button type="button" onClick={() => setTheme(Theme.Dark)}>
				choose dark
			</button>
		</>
	);
};

/** jsdom's one storage outlives every test in the file, so it is set up per test rather than left to whatever ran before. */
const setupThemeProvider = ({ defaultTheme, stored }: { defaultTheme?: Theme; stored?: string } = {}) => {
	localStorage.clear();

	if (stored !== undefined) {
		localStorage.setItem(themeStorageKey, stored);
	}

	render(
		<ThemeProvider defaultTheme={defaultTheme}>
			<ThemeControls />
		</ThemeProvider>,
	);
};

afterEach(() => {
	document.documentElement.classList.remove(Theme.Light, Theme.Dark);
});

describe('ThemeProvider', () => {
	test('starts light, which is what the server sent', () => {
		setupThemeProvider();

		expect(screen.getByText('theme: light')).toBeInTheDocument();
	});

	test('puts the theme on the document, which is where the tokens read it', () => {
		setupThemeProvider();

		expect(document.documentElement.classList.contains(Theme.Light)).toBe(true);
	});

	test('takes up the theme this reader chose on an earlier visit', () => {
		setupThemeProvider({ stored: Theme.Dark });

		expect(screen.getByText('theme: dark')).toBeInTheDocument();
	});

	test('ignores a stored value that is not a theme at all', () => {
		setupThemeProvider({ stored: 'chartreuse' });

		expect(screen.getByText('theme: light')).toBeInTheDocument();
	});

	test('ignores a choice to follow the system from before light and dark were the only two', () => {
		setupThemeProvider({ stored: 'system' });

		expect(screen.getByText('theme: light')).toBeInTheDocument();
	});

	test('keeps the default when storage is blocked, rather than throwing into the render tree', () => {
		jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('storage is blocked');
		});
		setupThemeProvider();

		expect(screen.getByText('theme: light')).toBeInTheDocument();
	});

	test('remembers a new choice for the next visit, and swaps the document over', () => {
		setupThemeProvider();

		fireEvent.click(screen.getByRole('button', { name: 'choose dark' }));

		expect({ stored: localStorage.getItem(themeStorageKey), isDark: document.documentElement.classList.contains(Theme.Dark) }).toStrictEqual({
			stored: Theme.Dark,
			isDark: true,
		});
	});

	test('still applies a choice this page cannot store', () => {
		setupThemeProvider();
		jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('storage is blocked');
		});

		fireEvent.click(screen.getByRole('button', { name: 'choose dark' }));

		expect(screen.getByText('theme: dark')).toBeInTheDocument();
	});
});
