import { createElement, type ReactNode } from 'react';

type Renderer = (props: { href?: string; children?: ReactNode }) => ReactNode;

interface Props {
	/** The document body, exactly as the real package takes it. */
	children: string;
	components: Record<string, Renderer>;
	remarkPlugins: unknown[];
}

/** Inline `[label](href)`, the one piece of markdown syntax this app decides for itself. */
const linkPattern = /\[([^\]]*)\]\(([^)]*)\)/g;

/**
 * A CommonJS stand-in for `react-markdown`.
 *
 * The real package is ESM-only and the shared Jest transform compiles only
 * `.ts`, `.tsx` and `.md`, so it cannot be loaded here however Jest is
 * configured. Parsing is the library's contract and is proved by the Vite build
 * and the dev run; what this app owns is the `components` map, so the stub
 * calls through it — the body as a paragraph, and every inline link through the
 * renderer that decides whether a link is safe to follow.
 */
const ReactMarkdown = ({ children, components }: Props) => {
	const Paragraph = components.p;
	const Link = components.a;

	return (
		<div data-slot="react-markdown-stub">
			{createElement(Paragraph, {}, children)}
			{[...children.matchAll(linkPattern)].map(([match, label, href]) => (
				<span key={match}>{createElement(Link, { href }, label)}</span>
			))}
		</div>
	);
};

export default ReactMarkdown;
