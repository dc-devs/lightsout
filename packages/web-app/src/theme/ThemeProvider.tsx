import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ResolvedTheme } from '#src/common/constants/ResolvedTheme.ts';
import { Theme } from '#src/common/constants/Theme.ts';
import { themeStorageKey } from '#src/common/constants/themeStorageKey.ts';
import { resolveThemeClass } from '#src/theme/resolveThemeClass.ts';
import { ThemeContext } from '#src/theme/ThemeContext.ts';

/** The stored preference, or undefined when nothing readable is stored — a browser with storage blocked throws on the very first read. */
const readStoredTheme = () => {
	let stored: Theme | undefined;

	try {
		const raw = localStorage.getItem(themeStorageKey);

		if (raw === Theme.Light || raw === Theme.Dark || raw === Theme.System) {
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
 * Holds the theme preference and keeps the `<html>` class in step with it.
 *
 * Every DOM and storage touch happens in an effect, which never runs on the
 * server — so the server render is inert and the first client render is
 * identical to it. The stored preference is read on mount rather than in
 * `useState`'s initialiser for the same reason: reading it during render would
 * make the two disagree and trip hydration. The inline script in the root
 * document is what stops a viewer who chose light from seeing dark first.
 */
export const ThemeProvider = ({ children, defaultTheme = Theme.Dark }: Props) => {
	const [theme, setStoredTheme] = useState<Theme>(defaultTheme);
	const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveThemeClass({ theme: defaultTheme }));

	useEffect(() => {
		const stored = readStoredTheme();

		if (stored !== undefined) {
			setStoredTheme(stored);
		}
	}, []);

	// Subscribed to only while following the operating system; any other
	// preference is an answer already, and the listener is removed on the way out.
	useEffect(() => {
		setResolvedTheme(resolveThemeClass({ theme }));

		if (theme !== Theme.System || typeof globalThis.matchMedia !== 'function') {
			return;
		}

		const query = globalThis.matchMedia('(prefers-color-scheme: dark)');
		const applySystemPreference = () => setResolvedTheme(resolveThemeClass({ theme }));

		query.addEventListener('change', applySystemPreference);

		return () => query.removeEventListener('change', applySystemPreference);
	}, [theme]);

	useEffect(() => {
		const element = document.documentElement;

		element.classList.remove(ResolvedTheme.Light, ResolvedTheme.Dark);
		element.classList.add(resolvedTheme);
	}, [resolvedTheme]);

	const setTheme = useCallback((next: Theme) => {
		setStoredTheme(next);
		writeStoredTheme({ theme: next });
	}, []);

	const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
