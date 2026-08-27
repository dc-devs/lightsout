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

/** A second- or third-level heading line — the two levels this app puts an anchor id on. */
const headingPattern = /^(#{2,3}) (.+)$/;

/**
 * A heading's children as the real parser hands them over: the plain words as
 * strings, and each backticked word as an element in the middle of them. The
 * app's id has to come out the same either way, so the stub has to be able to
 * produce both.
 */
const headingChildren = ({ raw, code }: { raw: string; code: Renderer }) =>
	raw.split(/`([^`]+)`/).map((part, index) => (index % 2 === 0 ? part : createElement(code, { key: `${index}-${part}` }, part)));

/**
 * A CommonJS stand-in for `react-markdown`.
 *
 * The real package is ESM-only and the shared Jest transform compiles only
 * `.ts`, `.tsx` and `.md`, so it cannot be loaded here however Jest is
 * configured. Parsing is the library's contract and is proved by the Vite build
 * and the dev run; what this app owns is the `components` map, so the stub
 * calls through it — the body as a paragraph, every inline link through the
 * renderer that decides whether a link is safe to follow, and every second- and
 * third-level heading through the renderer that gives it its anchor id.
 */
const ReactMarkdown = ({ children, components }: Props) => {
	const Paragraph = components.p;
	const Link = components.a;
	const code = components.code;

	return (
		<div data-slot="react-markdown-stub">
			{children
				.split('\n')
				.map((line) => headingPattern.exec(line))
				.filter((match) => match !== null)
				.map((match) =>
					createElement(match[1]?.length === 3 ? components.h3 : components.h2, { key: match[0] }, headingChildren({ raw: match[2] ?? '', code })),
				)}
			{createElement(Paragraph, {}, children)}
			{[...children.matchAll(linkPattern)].map(([match, label, href]) => (
				<span key={match}>{createElement(Link, { href }, label)}</span>
			))}
		</div>
	);
};

export default ReactMarkdown;
