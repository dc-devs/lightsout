import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { CtaBanner } from '#src/appUI/panels/CtaBanner.tsx';

const setupCtaBanner = ({ description }: { description?: string } = {}) => {
	const { container } = render(
		<CtaBanner title="Stop the slop." description={description}>
			<button type="button">npx lightsout init</button>
		</CtaBanner>,
	);

	return { container };
};

describe('CtaBanner', () => {
	test('leads with the one sentence the section is about', () => {
		setupCtaBanner();

		const heading = screen.getByRole('heading', { level: 2, name: 'Stop the slop.' });

		expect(heading).toBeInTheDocument();
	});

	test('carries the one thing to do about it', () => {
		setupCtaBanner();

		const action = screen.getByRole('button', { name: 'npx lightsout init' });

		expect(action).toBeInTheDocument();
	});

	test('says more under the heading when given a description', () => {
		setupCtaBanner({ description: 'Agents implement; the gates decide.' });

		const description = screen.getByText('Agents implement; the gates decide.');

		expect(description).toBeInTheDocument();
	});

	test('leaves the description out rather than rendering an empty line', () => {
		setupCtaBanner();

		const description = screen.queryByText('Agents implement; the gates decide.');

		expect(description).not.toBeInTheDocument();
	});

	test('lays the graph-paper wash behind it, hidden from assistive technology', () => {
		const { container } = setupCtaBanner();

		const wash = container.querySelector('[aria-hidden="true"]');

		expect(wash?.getAttribute('style')).toContain('var(--border)');
	});
});
