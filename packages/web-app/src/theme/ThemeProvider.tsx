import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Theme } from '#src/common/constants/Theme.ts';
import { themeStorageKey } from '#src/common/constants/themeStorageKey.ts';
import { ThemeContext } from '#src/theme/ThemeContext.ts';

/**
 * The stored choice, or undefined when nothing readable is stored — a browser
 * with storage blocked throws on the very first read, and a value from before
 * the choice was light or dark alone is not one of them.
 */
const readStoredTheme = () => {
	let stored: Theme | undefined;

	try {
		const raw = localStorage.getItem(themeStorageKey);

		if (raw === Theme.Light || raw === Theme.Dark) {
			stored = raw;
		}
	} catch {
		// Storage blocked: the default stands rather than throwing into the render tree.
	}

	return stored;
};

const writeStoredTheme = ({ theme }: { theme: Theme }) => {
	try {
		localStorage.setItem(themeStorageKey, theme);
	} catch {
		// Storage blocked: the choice still applies to this page, it just will not survive a reload.
	}
};

interface Props {
	children: ReactNode;
	defaultTheme?: Theme;
}

/**
 * Holds the theme and keeps the `<html>` class in step with it.
 *
 * Every DOM and storage touch happens in an effect, which never runs on the
 * server — so the server render is inert and the first client render is
 * identical to it. The stored choice is read on mount rather than in
 * `useState`'s initialiser for the same reason: reading it during render would
 * make the two disagree and trip hydration. The inline script in the root
 * document is what stops a viewer who chose dark from seeing light first.
 */
export const ThemeProvider = ({ children, defaultTheme = Theme.Light }: Props) => {
	const [theme, setStoredTheme] = useState<Theme>(defaultTheme);

	useEffect(() => {
		const stored = readStoredTheme();

		if (stored !== undefined) {
			setStoredTheme(stored);
		}
	}, []);

	useEffect(() => {
		const element = document.documentElement;

		element.classList.remove(Theme.Light, Theme.Dark);
		element.classList.add(theme);
	}, [theme]);

	const setTheme = useCallback((next: Theme) => {
		setStoredTheme(next);
		writeStoredTheme({ theme: next });
	}, []);

	const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
