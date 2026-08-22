/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DefaultCatchBoundary } from '#src/common/components/boundaries/DefaultCatchBoundary.tsx';
import { NotFound } from '#src/common/components/boundaries/NotFound.tsx';
import { ResolvedTheme } from '#src/common/constants/ResolvedTheme.ts';
import { Theme } from '#src/common/constants/Theme.ts';
import { themeStorageKey } from '#src/common/constants/themeStorageKey.ts';
import { AppShell, repoRootQueryOptions } from '#src/features/app/index.ts';
import appCss from '#src/styles/app.css?url';
import { resolveThemeClass, ThemeProvider } from '#src/theme/index.ts';

/**
 * The one inline script in the app.
 *
 * The server always sends the dark class, because it cannot know what this
 * viewer chose. A viewer who chose light would then see dark for a frame, so
 * this runs before the stylesheet is applied and swaps the class. The provider
 * reads the same key in an effect, which is why nothing here causes a
 * hydration mismatch. A browser with storage blocked throws on the first read
 * and is left with the server's answer.
 */
const themeScript = `try {
	var stored = localStorage.getItem('${themeStorageKey}');
	var light = stored === '${Theme.Light}';
	if (stored === '${Theme.System}') { light = matchMedia('(prefers-color-scheme: light)').matches; }
	if (light) {
		document.documentElement.classList.remove('${ResolvedTheme.Dark}');
		document.documentElement.classList.add('${ResolvedTheme.Light}');
	}
} catch (error) { }`;

const RootDocument = ({ children }: { children: ReactNode }) => (
	<html lang="en" className={`min-h-full min-w-full ${resolveThemeClass({ theme: Theme.Dark })}`}>
		<head>
			<script>{themeScript}</script>
			<HeadContent />
		</head>
		<body className="min-h-full min-w-full">
			{children}
			<Scripts />
		</body>
	</html>
);

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
	head: () => ({
		meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'lightsout' }],
		links: [{ rel: 'stylesheet', href: appCss }],
	}),
	// Only the question the shell itself asks — whether a repo was found at all.
	// The runs list is a page's concern now, and warming it here would make the
	// sell zone wait on run state it never shows.
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(repoRootQueryOptions());
	},
	errorComponent: (props) => (
		<RootDocument>
			<DefaultCatchBoundary {...props} />
		</RootDocument>
	),
	notFoundComponent: () => <NotFound />,
	component: () => (
		<RootDocument>
			<ThemeProvider defaultTheme={Theme.Dark}>
				<AppShell />
			</ThemeProvider>
		</RootDocument>
	),
});
