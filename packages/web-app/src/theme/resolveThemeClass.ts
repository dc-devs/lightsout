import { ResolvedTheme } from '#src/common/constants/ResolvedTheme.ts';
import { Theme } from '#src/common/constants/Theme.ts';

interface Params {
	theme: Theme;
}

/**
 * Which class the `<html>` element carries for a given preference.
 *
 * Dark is the answer wherever the operating system cannot be asked — the server
 * render, and any browser without `matchMedia`. That is what makes dark the
 * default without a flash: the server sends the same class the client resolves.
 */
export const resolveThemeClass = ({ theme }: Params): ResolvedTheme => {
	let resolved: ResolvedTheme = ResolvedTheme.Dark;

	if (theme === Theme.Light) {
		resolved = ResolvedTheme.Light;
	} else if (theme === Theme.System && typeof globalThis.matchMedia === 'function') {
		resolved = globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? ResolvedTheme.Dark : ResolvedTheme.Light;
	}

	return resolved;
};
