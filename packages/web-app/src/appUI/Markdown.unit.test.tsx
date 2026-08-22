import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Markdown } from '#src/appUI/Markdown.tsx';

const setupMarkdown = ({ text }: { text: string }) => {
	render(<Markdown text={text} />);
};

describe('Markdown', () => {
	test("shows a plan's front matter as metadata rather than as prose", () => {
		setupMarkdown({ text: '---\nphase: 4\n---\nRun detail.\n' });

		const term = screen.getByText('phase');

		expect(term.nextElementSibling).toHaveTextContent('4');
	});

	test('keeps the front matter out of the body handed to the renderer', () => {
		setupMarkdown({ text: '---\nphase: 4\n---\nRun detail.\n' });

		const body = screen.getByText(/Run detail\./);

		expect(body.textContent).not.toContain('phase');
	});

	test("styles the document with this app's own typography rather than the library's defaults", () => {
		setupMarkdown({ text: 'Run detail.' });

		const body = screen.getByText('Run detail.');

		expect(body.className).toContain('leading-6');
	});

	test('follows a link a plan can safely point at', () => {
		setupMarkdown({ text: 'See [the docs](https://example.com/plans).' });

		const link = screen.getByRole('link', { name: 'the docs' });

		expect(link).toHaveAttribute('href', 'https://example.com/plans');
	});

	test('renders a link no reader should be able to trigger as plain text', () => {
		setupMarkdown({ text: 'See [the trap](javascript:alert(1)).' });

		const trap = screen.queryByRole('link', { name: 'the trap' });

		expect(trap).not.toBeInTheDocument();
	});

	test('still shows what an unfollowable link said', () => {
		setupMarkdown({ text: 'See [the trap](javascript:alert(1)).' });

		const label = screen.getByText('the trap');

		expect(label.tagName).toBe('SPAN');
	});

	test.each([
		{ label: 'the plain web', href: 'http://example.com/plans' },
		{ label: 'a file in the repo', href: '/plans/phase-4.md' },
		{ label: 'the plan beside it', href: './phase-5.md' },
		{ label: 'the folder above', href: '../overview.md' },
		{ label: 'a heading further down', href: '#scope-boundaries' },
	])('follows a link pointing at $href', ({ label, href }) => {
		setupMarkdown({ text: `See [${label}](${href}).` });

		const link = screen.getByRole('link', { name: label });

		expect(link).toHaveAttribute('href', href);
	});

	test('sends a reader following a link to a new tab without handing over where they came from', () => {
		setupMarkdown({ text: 'See [the docs](https://example.com/plans).' });

		const link = screen.getByRole('link', { name: 'the docs' });

		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noreferrer');
	});

	test('paints a followable link with the theme tokens rather than a colour of its own', () => {
		setupMarkdown({ text: 'See [the docs](https://example.com/plans).' });

		const classes = screen.getByRole('link', { name: 'the docs' }).className.split(' ');

		expect(classes).toEqual(expect.arrayContaining(['text-brand-to', 'underline', 'underline-offset-4']));
	});

	test('leaves a link no reader can follow in the muted token, so it never reads as followable', () => {
		setupMarkdown({ text: 'See [the trap](javascript:alert(1)).' });

		const classes = screen.getByText('the trap').className.split(' ');

		expect(classes).toEqual(expect.arrayContaining(['text-muted-foreground-strong']));
	});

	test('shows a quoted front-matter value without the quotes it was written with', () => {
		setupMarkdown({ text: '---\nphase: 4\ntitle: "Run detail"\n---\nWhat the page shows.\n' });

		const term = screen.getByText('title');

		expect(term.nextElementSibling).toHaveTextContent('Run detail');
	});

	test('lists every entry of a front-matter block, in the order the plan wrote them', () => {
		setupMarkdown({ text: '---\nphase: 4\ntitle: "Run detail"\n---\nWhat the page shows.\n' });

		const names = screen.getAllByRole('term');

		expect(names.map((name) => name.textContent)).toStrictEqual(['phase', 'title']);
	});

	test('ignores a front-matter line that names no key', () => {
		setupMarkdown({ text: '---\nphase: 4\njust a sentence\n---\nWhat the page shows.\n' });

		const names = screen.getAllByRole('term');

		expect(names.map((name) => name.textContent)).toStrictEqual(['phase']);
	});

	test('leaves a horizontal rule further down the document in the body', () => {
		setupMarkdown({ text: '# Run detail\n\n---\n\nWhat the page shows.\n' });

		const body = screen.getByText(/What the page shows/);

		expect(body.textContent).toContain('---');
	});

	test('shows no metadata block for a document that has no front matter', () => {
		setupMarkdown({ text: '# Run detail\n\n---\n\nWhat the page shows.\n' });

		const names = screen.queryAllByRole('term');

		expect(names).toHaveLength(0);
	});

	test('treats an opening fence that never closes as ordinary body text', () => {
		setupMarkdown({ text: '---\nphase: 4\nstill going\n' });

		const body = screen.getByText(/still going/);

		expect(body.textContent).toContain('phase: 4');
	});
});
