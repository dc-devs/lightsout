import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ResolvedTheme } from '#src/common/constants/ResolvedTheme.ts';
import { Theme } from '#src/common/constants/Theme.ts';
import { themeStorageKey } from '#src/common/constants/themeStorageKey.ts';
import { ThemeProvider } from '#src/theme/ThemeProvider.tsx';
import { useTheme } from '#src/theme/useTheme.ts';

/** A reader of the context that can also change it, so one render covers both halves. */
const ThemeControls = () => {
	const { theme, resolvedTheme, setTheme } = useTheme();

	return (
		<>
			<p>
				{theme} renders {resolvedTheme}
			</p>
			<button type="button" onClick={() => setTheme(Theme.Light)}>
				choose light
			</button>
			<button type="button" onClick={() => setTheme(Theme.System)}>
				follow the system
			</button>
		</>
	);
};

/**
 * jsdom implements no `matchMedia`, and its one storage outlives every test in
 * the file — so both are set up per test rather than left to whatever ran
 * before.
 */
const setupThemeProvider = ({ defaultTheme, stored, systemPrefersDark }: { defaultTheme?: Theme; stored?: string; systemPrefersDark?: boolean } = {}) => {
	localStorage.clear();

	if (stored !== undefined) {
		localStorage.setItem(themeStorageKey, stored);
	}

	const removeEventListener = jest.fn<(name: string, listener: () => void) => void>();
	let systemIsDark = systemPrefersDark ?? false;
	let notifySystemChange = () => {};

	if (systemPrefersDark !== undefined) {
		// Read fresh on every call, so a test can flip the operating system's
		// preference under a mounted provider the way a reader's machine would.
		Object.assign(globalThis, {
			matchMedia: () => ({
				get matches() {
					return systemIsDark;
				},
				addEventListener: (_name: string, listener: () => void) => {
					notifySystemChange = listener;
				},
				removeEventListener,
			}),
		});
	}

	const { unmount } = render(
		<ThemeProvider defaultTheme={defaultTheme}>
			<ThemeControls />
		</ThemeProvider>,
	);

	const changeSystemPreference = ({ prefersDark }: { prefersDark: boolean }) => {
		systemIsDark = prefersDark;
		act(() => notifySystemChange());
	};

	return { changeSystemPreference, removeEventListener, unmount };
};

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'matchMedia');
	document.documentElement.classList.remove(ResolvedTheme.Light, ResolvedTheme.Dark);
});

describe('ThemeProvider', () => {
	test('starts dark, which is what the server sent', () => {
		setupThemeProvider();

		const readout = screen.getByText('dark renders dark');

		expect(readout).toBeInTheDocument();
	});

	test('puts that answer on the document, which is where the tokens read it', () => {
		setupThemeProvider();

		expect(document.documentElement.classList.contains(ResolvedTheme.Dark)).toBe(true);
	});

	test('takes up the preference this reader chose on an earlier visit', () => {
		setupThemeProvider({ stored: Theme.Light });

		const readout = screen.getByText('light renders light');

		expect(readout).toBeInTheDocument();
	});

	test('ignores a stored value that is not a theme at all', () => {
		setupThemeProvider({ stored: 'chartreuse' });

		const readout = screen.getByText('dark renders dark');

		expect(readout).toBeInTheDocument();
	});

	test('keeps the default when storage is blocked, rather than throwing into the render tree', () => {
		jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('storage is blocked');
		});
		setupThemeProvider();

		const readout = screen.getByText('dark renders dark');

		expect(readout).toBeInTheDocument();
	});

	test('remembers a new choice for the next visit', () => {
		setupThemeProvider();

		fireEvent.click(screen.getByRole('button', { name: 'choose light' }));

		expect(localStorage.getItem(themeStorageKey)).toBe(Theme.Light);
		expect(screen.getByText('light renders light')).toBeInTheDocument();
	});

	test('still applies a choice this page cannot store', () => {
		setupThemeProvider();
		jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('storage is blocked');
		});

		fireEvent.click(screen.getByRole('button', { name: 'choose light' }));

		expect(screen.getByText('light renders light')).toBeInTheDocument();
	});

	test('renders what the operating system asked for while following it', () => {
		setupThemeProvider({ defaultTheme: Theme.System, systemPrefersDark: false });

		const readout = screen.getByText('system renders light');

		expect(readout).toBeInTheDocument();
	});

	test('follows the operating system when it changes under the reader', () => {
		const { changeSystemPreference } = setupThemeProvider({ defaultTheme: Theme.System, systemPrefersDark: false });

		changeSystemPreference({ prefersDark: true });

		expect(document.documentElement.classList.contains(ResolvedTheme.Dark)).toBe(true);
		expect(screen.getByText('system renders dark')).toBeInTheDocument();
	});

	test('stops listening to the operating system once it is no longer being followed', () => {
		const { removeEventListener } = setupThemeProvider({ defaultTheme: Theme.System, systemPrefersDark: true });

		fireEvent.click(screen.getByRole('button', { name: 'choose light' }));

		expect(removeEventListener).toHaveBeenCalled();
	});

	test('lets go of the operating system listener when the page it is on goes away', () => {
		const { removeEventListener, unmount } = setupThemeProvider({ defaultTheme: Theme.System, systemPrefersDark: true });

		unmount();

		expect(removeEventListener).toHaveBeenCalledTimes(1);
	});

	test('takes up the choice to follow the system from an earlier visit', () => {
		setupThemeProvider({ stored: Theme.System, systemPrefersDark: false });

		const readout = screen.getByText('system renders light');

		expect(readout).toBeInTheDocument();
	});

	test('settles on dark for a reader following a system that cannot be asked', () => {
		setupThemeProvider({ defaultTheme: Theme.System });

		const readout = screen.getByText('system renders dark');

		expect(readout).toBeInTheDocument();
	});
});
