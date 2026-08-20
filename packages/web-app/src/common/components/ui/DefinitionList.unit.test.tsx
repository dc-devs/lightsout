import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DefinitionList } from '#src/common/components/ui/DefinitionList.tsx';

const setupDefinitionList = ({ entries = [['severity', 'blocking']], className }: { entries?: [string, ReactNode][]; className?: string } = {}) => {
	render(<DefinitionList entries={entries} className={className} />);
};

describe('DefinitionList', () => {
	test('renders each term beside its value', () => {
		setupDefinitionList();

		const term = screen.getByText('severity');

		expect(term.nextElementSibling?.textContent).toBe('blocking');
	});

	test('keeps the rows in the order they were given, since that order is the argument', () => {
		setupDefinitionList({
			entries: [
				['set', 'code'],
				['severity', 'blocking'],
			],
		});

		const terms = screen.getAllByRole('term').map((term) => term.textContent);

		expect(terms).toStrictEqual(['set', 'severity']);
	});

	test('takes a value that is marked up rather than only a string', () => {
		setupDefinitionList({
			entries: [
				[
					'document',
					<span key="document" className="font-mono">
						code/style-guide
					</span>,
				],
			],
		});

		const value = screen.getByText('code/style-guide');

		expect(value).toHaveClass('font-mono');
	});

	test('lets a caller add to the box without restating it', () => {
		setupDefinitionList({ className: 'mb-4' });

		const list = screen.getByText('severity').closest('dl');

		expect(list).toHaveClass('mb-4');
	});
});
