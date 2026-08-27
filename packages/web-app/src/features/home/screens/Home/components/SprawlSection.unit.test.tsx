import { afterEach, describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { SprawlSection } from '#src/features/home/screens/Home/components/SprawlSection.tsx';
import { getSprawlDataset } from '#src/features/sprawl/index.ts';

const realRequest = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

/** The comparison's loop is driven by hand: jsdom's own frames land outside React's act boundary. */
const setupSprawlSection = () => {
	Object.assign(globalThis, { requestAnimationFrame: () => 0, cancelAnimationFrame: () => undefined });

	render(<SprawlSection />);

	return { caps: getSprawlDataset().caps };
};

afterEach(() => {
	Object.assign(globalThis, { requestAnimationFrame: realRequest, cancelAnimationFrame: realCancel });
});

describe('SprawlSection', () => {
	test('states the rule in one sentence', () => {
		setupSprawlSection();

		expect(screen.getByRole('heading', { level: 2, name: 'Files and folders have caps. Past the cap, they graduate.' })).toBeInTheDocument();
	});

	test('reads every number from the pack’s own settings, so tuning a cap changes this paragraph', () => {
		const { caps } = setupSprawlSection();

		const numbers = screen.getByText(/checked by code, not vibes/);

		expect(numbers.textContent).toContain(`functions ${caps.function} lines`);
		expect(numbers.textContent).toContain(`files ${caps.file}`);
		expect(numbers.textContent).toContain(`test files ${caps.testFile}`);
	});

	test('shows the two lanes rather than asserting the difference in prose', () => {
		setupSprawlSection();

		expect(screen.getByText('Top: the same commits with every split undone. Bottom: what actually happened.')).toBeInTheDocument();
	});
});
