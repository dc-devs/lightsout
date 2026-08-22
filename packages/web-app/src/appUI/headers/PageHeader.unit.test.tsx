import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { ScrollText } from 'lucide-react';
import { PageHeader } from '#src/appUI/headers/PageHeader.tsx';

const setupPageHeader = ({ withIcon = false, description, action }: { withIcon?: boolean; description?: string; action?: string } = {}) => {
	const { container } = render(
		<PageHeader
			icon={withIcon ? ScrollText : undefined}
			title="Runs"
			description={description}
			action={action === undefined ? undefined : <button type="button">{action}</button>}
		/>,
	);

	return { container };
};

describe('PageHeader', () => {
	test('names the page as its first heading', () => {
		setupPageHeader();

		const heading = screen.getByRole('heading', { level: 1, name: 'Runs' });

		expect(heading).toBeInTheDocument();
	});

	test('says what the page is for when given a description', () => {
		setupPageHeader({ description: 'Every run this repo has on disk.' });

		const description = screen.getByText('Every run this repo has on disk.');

		expect(description).toBeInTheDocument();
	});

	test('leaves the description out rather than rendering an empty line', () => {
		setupPageHeader();

		const description = screen.queryByText('Every run this repo has on disk.');

		expect(description).not.toBeInTheDocument();
	});

	test('puts the page action beside the name', () => {
		setupPageHeader({ action: 'Copy id' });

		const action = screen.getByRole('button', { name: 'Copy id' });

		expect(action).toBeInTheDocument();
	});

	test('takes an icon for the page without announcing it', () => {
		const { container } = setupPageHeader({ withIcon: true });

		const icon = container.querySelector('svg[aria-hidden="true"]');

		expect(icon).toBeInTheDocument();
	});

	test('leaves the icon slot empty rather than reserving a blank one', () => {
		const { container } = setupPageHeader();

		const icon = container.querySelector('svg');

		expect(icon).not.toBeInTheDocument();
	});
});
