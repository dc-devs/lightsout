/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DefaultCatchBoundary } from '#src/common/components/boundaries/DefaultCatchBoundary.tsx';
import { NotFound } from '#src/common/components/boundaries/NotFound.tsx';
import { AppShell, repoRootQueryOptions } from '#src/features/app/index.ts';
import { runsQueryOptions } from '#src/features/runs/index.ts';
import appCss from '#src/styles/app.css?url';

const RootDocument = ({ children }: { children: ReactNode }) => (
	<html lang="en" className="min-h-full min-w-full">
		<head>
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
	// Both queries the shell reads, warmed before the first render, so the server
	// sends a populated sidebar rather than a skeleton the client has to replace.
	loader: async ({ context }) => {
		await Promise.all([context.queryClient.ensureQueryData(runsQueryOptions()), context.queryClient.ensureQueryData(repoRootQueryOptions())]);
	},
	errorComponent: (props) => (
		<RootDocument>
			<DefaultCatchBoundary {...props} />
		</RootDocument>
	),
	notFoundComponent: () => <NotFound />,
	component: () => (
		<RootDocument>
			<AppShell />
		</RootDocument>
	),
});
