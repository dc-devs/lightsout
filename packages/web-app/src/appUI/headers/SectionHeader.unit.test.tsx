import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { SectionHeader } from '#src/appUI/headers/SectionHeader.tsx';

const setupSectionHeader = ({ description, action, className }: { description?: string; action?: string; className?: string } = {}) => {
	render(
		<SectionHeader
			title="Gate evidence"
			description={description}
			action={action === undefined ? undefined : <button type="button">{action}</button>}
			className={className}
		/>,
	);
};

describe('SectionHeader', () => {
	test('names the section one level below the page', () => {
		setupSectionHeader();

		const heading = screen.getByRole('heading', { level: 2, name: 'Gate evidence' });

		expect(heading).toBeInTheDocument();
	});

	test('says what the section holds when given a description', () => {
		setupSectionHeader({ description: 'What each gate reported.' });

		const description = screen.getByText('What each gate reported.');

		expect(description).toBeInTheDocument();
	});

	test('leaves the description out rather than rendering an empty line', () => {
		setupSectionHeader();

		const description = screen.queryByText('What each gate reported.');

		expect(description).not.toBeInTheDocument();
	});

	test('puts the section action on the heading row', () => {
		setupSectionHeader({ action: 'Expand all' });

		const action = screen.getByRole('button', { name: 'Expand all' });

		expect(action).toBeInTheDocument();
	});

	test('lets a caller class through', () => {
		setupSectionHeader({ className: 'mt-8' });

		const heading = screen.getByRole('heading', { level: 2, name: 'Gate evidence' });

		expect(heading.closest('div')?.parentElement?.className).toContain('mt-8');
	});
});
