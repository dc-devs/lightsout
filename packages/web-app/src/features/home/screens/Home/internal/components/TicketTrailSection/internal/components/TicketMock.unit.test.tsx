import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { TicketMock } from '#src/features/home/screens/Home/internal/components/TicketTrailSection/internal/components/TicketMock.tsx';

describe('TicketMock', () => {
	test('shows the files lightsout attaches, by the names it attaches them under', () => {
		render(<TicketMock />);

		expect(['brainstorm-notes.md', 'brainstorm-decisions.json', 'plan.md'].map((file) => screen.getByText(file))).toHaveLength(3);
	});

	test('shows the ticket history from brainstorm to merge, oldest first', () => {
		render(<TicketMock />);

		const history = screen.getAllByRole('listitem').map((item) => item.textContent);

		expect(history.slice(-4)).toStrictEqual([
			'Brainstorm published: design and decisions attached',
			'Plan graded A and published',
			'Pull request opened, linked to this ticket',
			'Merged, ticket closed',
		]);
	});

	test('names itself for a screen reader, since the picture is made of parts', () => {
		render(<TicketMock />);

		expect(screen.getByRole('figure', { name: 'A ticket with its brainstorm, plan and history attached' })).toBeInTheDocument();
	});

	test('is a Linear ticket from lightsout’s own board', () => {
		const { container } = render(<TicketMock />);

		expect({ key: screen.getByText('LO-155').textContent, logo: container.querySelector('svg[fill="#5E6AD2"]') !== null }).toStrictEqual({
			key: 'LO-155',
			logo: true,
		});
	});
});
