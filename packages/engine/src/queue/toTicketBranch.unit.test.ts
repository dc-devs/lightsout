import { describe, expect, test } from '@jest/globals';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';

const ticketOf = (overrides: Partial<TicketSummary> = {}): TicketSummary => ({
	id: 'id-1',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	route: QueueRoute.Direct,
	...overrides,
});

describe('toTicketBranch', () => {
	test('renders the default shape: the lowercased identifier, then the slugged title', () => {
		expect(toTicketBranch({ ticket: ticketOf(), template: '{ticket}-{slug}' })).toBe('lo-70-drain-the-backlog');
	});

	test('honours a company convention the template states, so a mandated branch shape needs no engine change', () => {
		expect(toTicketBranch({ ticket: ticketOf(), template: 'feature/{ticket}-{slug}' })).toBe('feature/lo-70-drain-the-backlog');
	});

	test('leaves a token it does not know exactly as written, matching how the pull request body template treats one', () => {
		expect(toTicketBranch({ ticket: ticketOf(), template: '{ticket}-{author}' })).toBe('lo-70-{author}');
	});

	test('collapses punctuation and spacing into single dashes, and never leaves one at either end', () => {
		expect(toTicketBranch({ ticket: ticketOf({ title: '  Fix: the (broken) thing!  ' }), template: '{slug}' })).toBe('fix-the-broken-thing');
	});

	test('cuts a long title on a dash rather than mid-word, so the branch stays readable', () => {
		const branch = toTicketBranch({ ticket: ticketOf({ title: 'Rework the entire deterministic verification pipeline end to end' }), template: '{slug}' });

		expect(branch.length).toBeLessThanOrEqual(40);
		expect(branch).toBe('rework-the-entire-deterministic');
	});

	test('answers an empty slug for a title with nothing branch-safe in it, rather than a dash on its own', () => {
		expect(toTicketBranch({ ticket: ticketOf({ title: '???' }), template: '{slug}' })).toBe('');
	});
});
