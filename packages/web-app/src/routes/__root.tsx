/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DefaultCatchBoundary } from '#src/common/components/boundaries/DefaultCatchBoundary.tsx';
import { NotFound } from '#src/common/components/boundaries/NotFound.tsx';
import { Theme } from '#src/common/constants/Theme.ts';
import { themeStorageKey } from '#src/common/constants/themeStorageKey.ts';
import appCss from '#src/styles/app.css?url';
import { ThemeProvider } from '#src/theme/index.ts';

/**
 * The one inline script in the app.
 *
 * The server always sends the light class, because it cannot know what this
 * viewer chose. A viewer who chose dark would then see light for a frame, so
 * this runs before the stylesheet is applied and swaps the class. The provider
 * reads the same key in an effect, which is why nothing here causes a
 * hydration mismatch. A browser with storage blocked throws on the first read
 * and is left with the server's answer.
 */
const themeScript = `try {
	var stored = localStorage.getItem('${themeStorageKey}');
	if (stored === '${Theme.Dark}') {
		document.documentElement.classList.remove('${Theme.Light}');
		document.documentElement.classList.add('${Theme.Dark}');
	}
} catch (error) { }`;

const RootDocument = ({ children }: { children: ReactNode }) => (
	<html lang="en" className={`min-h-full min-w-full ${Theme.Light}`}>
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
	errorComponent: (props) => (
		<RootDocument>
			<DefaultCatchBoundary {...props} />
		</RootDocument>
	),
	notFoundComponent: () => <NotFound />,
	// The document and the theme, and nothing else. Which frame a page wears is
	// decided one level down: `_site.tsx` for the public pages, `app.tsx` for
	// the pages that read this machine's repository.
	component: () => (
		<RootDocument>
			<ThemeProvider defaultTheme={Theme.Light}>
				<Outlet />
			</ThemeProvider>
		</RootDocument>
	),
});
