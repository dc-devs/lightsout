import { describe, expect, test } from '@jest/globals';
import { QueueBoardTicket } from '#src/contracts/index.ts';

const setupTicket = ({ lane = 'build-queue' }: { lane?: string } = {}) => {
	const ticket = {
		identifier: 'LO-136',
		lane,
		enteredAt: '2026-09-10T09:30:00.000Z',
	};

	return { ticket };
};

describe('QueueBoardTicket', () => {
	test('accepts a ticket that carries only its identifier, its lane and when it entered it', () => {
		const { ticket } = setupTicket();

		const parsed = QueueBoardTicket.parse(ticket);

		expect(parsed).toStrictEqual({
			identifier: 'LO-136',
			lane: 'build-queue',
			enteredAt: '2026-09-10T09:30:00.000Z',
		});
	});

	test('refuses a lane that is not one of the seven', () => {
		const { ticket } = setupTicket({ lane: 'in-progress' });

		const result = QueueBoardTicket.safeParse(ticket);

		expect(result.success).toBe(false);
	});
});
