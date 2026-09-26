import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { TicketTrailSection } from '#src/features/home/screens/Home/internal/components/TicketTrailSection/TicketTrailSection.tsx';

describe('TicketTrailSection', () => {
	test('says every decision is recorded on the reader’s ticket, in two lines', () => {
		render(<TicketTrailSection />);

		expect(screen.getByRole('heading', { level: 2, name: 'Every decision, recorded on your ticket.' })).toBeInTheDocument();
	});

	test('names what lightsout writes to the tracker today', () => {
		render(<TicketTrailSection />);

		const shipped = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

		expect(shipped).toStrictEqual([
			'Every decision, attached',
			'Status that keeps itself current',
			'Tickets drafted, you approve',
			'Agent cost on every ticketComing soon',
		]);
	});

	test('marks the one thing not built yet as coming, rather than claiming it', () => {
		render(<TicketTrailSection />);

		expect(screen.getByText('Coming soon').parentElement).toHaveTextContent('Agent cost on every ticket');
	});
});
