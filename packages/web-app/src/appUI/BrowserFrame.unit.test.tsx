import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { BrowserFrame } from '#src/appUI/BrowserFrame.tsx';

const setupBrowserFrame = ({ className }: { className?: string } = {}) => {
	const { container } = render(
		<BrowserFrame url="lightsout.dev/repo/runs" className={className}>
			<a href="/repo/runs">a run</a>
		</BrowserFrame>,
	);

	return { container };
};

describe('BrowserFrame', () => {
	test('shows the address the framed page would be at', () => {
		setupBrowserFrame();

		const url = screen.getByText('lightsout.dev/repo/runs');

		expect(url).toBeInTheDocument();
	});

	test('renders whatever it is given inside the frame', () => {
		setupBrowserFrame();

		const content = screen.getByText('a run');

		expect(content).toBeInTheDocument();
	});

	test('makes every link inside inert, so a demo render cannot navigate a reader away', () => {
		const { container } = setupBrowserFrame();

		const body = container.querySelector('.\\[\\&_a\\]\\:pointer-events-none');

		expect(body).toBeInTheDocument();
	});

	test('sets the address in the mono face, which is what makes it read as an address bar', () => {
		setupBrowserFrame();

		const url = screen.getByText('lightsout.dev/repo/runs');

		expect(url.className).toContain('font-mono');
	});

	test('hides the three chrome dots from assistive technology, being decoration and nothing else', () => {
		const { container } = setupBrowserFrame();

		const dots = container.querySelector('[aria-hidden="true"]');

		expect(dots?.children).toHaveLength(3);
	});

	test('lets a caller class through', () => {
		const { container } = setupBrowserFrame({ className: 'max-w-4xl' });

		expect(container.firstElementChild?.className).toContain('max-w-4xl');
	});
});
