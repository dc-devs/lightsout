import { describe, expect, test } from '@jest/globals';
import type { ConfigView } from '#src/contracts/index.ts';
import { getConfigView } from '#src/views/index.ts';
import { jiraTicketTrackerConfigBlock, ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

/** One row out of the grouped sections, by the key the file would spell. */
const findField = ({ sections, key }: { sections: ConfigView['sections']; key: string }) =>
	sections.flatMap((section) => section.fields).find((field) => field.key === key);

// The opt-in blocks the page shows whole: each one is a single row carrying the
// file's own object, and a row that stays null when the file omits the block.

describe('getConfigView', () => {
	test('shows the ship block whole in its own area, because no leaf of it has a default worth a row of its own', async () => {
		const cwd = await seedConfiguredCwd({
			config: { ship: { 'ticket-pattern': '^(?<ticket>ab-\\d+)', 'pr-body': 'Closes {ticket}', 'merge-method': 'squash' } },
		});

		const view = await getConfigView({ cwd });

		const ship = view.sections.find((section) => section.title === 'Ship');

		expect(ship?.fields).toEqual([
			expect.objectContaining({
				key: 'ship',
				value: { 'ticket-pattern': '^(?<ticket>ab-\\d+)', 'pr-body': 'Closes {ticket}', 'merge-method': 'squash' },
				fromConfig: true,
			}),
		]);
	});

	test('leaves ship null when the file omits it, because ship is opt-in and the engine fills nothing in for it', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'ship' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('shows the ticket-tracker block whole in its own area, because tracker identity is its own fact rather than a leaf of the queue', async () => {
		const cwd = await seedConfiguredCwd({ config: { 'ticket-tracker': ticketTrackerConfigBlock } });

		const view = await getConfigView({ cwd });

		const tracker = view.sections.find((section) => section.title === 'Ticket tracker');

		expect(tracker?.fields).toEqual([
			// the sentence is the schema's own, so the page and the config reference
			// cannot say different things about the same block
			expect.objectContaining({
				key: 'ticket-tracker',
				value: { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' },
				fromConfig: true,
				description: expect.stringContaining('tracker'),
			}),
		]);
	});

	test('leaves ticket-tracker null when the file omits it, because the block is opt-in and the engine runs with no tracker at all', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'ticket-tracker' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('shows the Jira tracker branch whole too, without leaking its identity back into the queue section', async () => {
		const cwd = await seedConfiguredCwd({ config: { 'ticket-tracker': jiraTicketTrackerConfigBlock } });

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'ticket-tracker' })).toEqual(
			expect.objectContaining({ value: jiraTicketTrackerConfigBlock, fromConfig: true, description: expect.stringContaining('Jira') }),
		);
		expect(findField({ sections: view.sections, key: 'queue' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('shows the queue block whole in its own area, so the block the document documents is on the page too', async () => {
		const queue = {
			'planning-status-labels': { 'planning-complete': 'shaped' },
			'max-parallel': 2,
		};
		const cwd = await seedConfiguredCwd({ config: { queue } });

		const view = await getConfigView({ cwd });

		const queueSection = view.sections.find((section) => section.title === 'Queue');

		expect(queueSection?.fields).toEqual([
			// the sentence is the schema's own, so the page and the config reference
			// cannot say different things about the same block
			expect.objectContaining({ key: 'queue', value: queue, fromConfig: true, description: expect.stringContaining('planning status') }),
		]);
	});

	test('carries every leaf of the queue block through untouched, because the view names no key inside it', async () => {
		const queue = {
			'planning-status-labels': {
				'planning-needs-brainstorm': 'needs-brainstorm',
				'planning-needs-plan': 'needs-plan',
				'planning-ready-auto-plan': 'ready-auto-plan',
				'planning-complete': 'shaped',
				'planning-not-needed': 'no-shaping',
			},
			'ready-status': 'Ready to build',
			'done-status': 'Shipped',
			'eligible-statuses': ['Backlog', 'Ready to build'],
			'max-parallel': 2,
		};
		const cwd = await seedConfiguredCwd({ config: { queue } });

		const view = await getConfigView({ cwd });

		// a repo that spells every label and status its own way must see all of them
		// on the page — the block travels whole, so a dropped leaf here is a lie
		expect(findField({ sections: view.sections, key: 'queue' })).toEqual(expect.objectContaining({ value: queue, fromConfig: true }));
	});

	test('leaves queue null when the file omits it, because the block is opt-in and the engine fills nothing in for it', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'queue' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('shows the auto-plan block whole in its own area, because no leaf of it has a default worth a row of its own', async () => {
		const cwd = await seedConfiguredCwd({ config: { 'auto-plan': { 'implement-on-approval': true, 'auto-approve-plan': false } } });

		const view = await getConfigView({ cwd });

		const autoPlan = view.sections.find((section) => section.title === 'Auto plan');

		expect(autoPlan?.fields).toEqual([
			expect.objectContaining({ key: 'auto-plan', value: { 'implement-on-approval': true, 'auto-approve-plan': false }, fromConfig: true }),
		]);
	});

	test('leaves auto-plan null when the file omits it, because the block is opt-in and the engine fills nothing in for it', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'auto-plan' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('shows the plan block whole in its own area, thresholds and all', async () => {
		const plan = { contract: true, 'weight-thresholds': { 'created-files': 5, packages: 2 } };
		const cwd = await seedConfiguredCwd({ config: { plan } });

		const view = await getConfigView({ cwd });

		const planSection = view.sections.find((section) => section.title === 'Plan');

		expect(planSection?.fields).toEqual([
			// the sentence is the schema's own, so the page and the config reference
			// cannot say different things about the same block
			expect.objectContaining({ key: 'plan', value: plan, fromConfig: true, description: expect.stringContaining('acceptance-test ledger') }),
		]);
	});

	test('leaves plan null when the file omits it, because the block is opt-in and the engine fills nothing in for it', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'plan' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('shows the implement block whole in its own area, with the cleanup budget the file itself typed', async () => {
		const implement = { refactor: { 'max-rounds': 5 } };
		const cwd = await seedConfiguredCwd({ config: { implement } });

		const view = await getConfigView({ cwd });

		// read off the file's own text, so the kebab-case leaf arrives untouched and
		// the row says the repo chose 5 rather than the engine defaulting to 2
		expect(findField({ sections: view.sections, key: 'implement' })).toEqual(
			expect.objectContaining({ value: implement, fromConfig: true, description: expect.stringContaining('max-rounds') }),
		);
	});

	test('leaves implement null when the file omits it, because the block is opt-in and the round budget lives in the engine rather than the row', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		// the row is present and unset rather than absent — the page has to show the
		// block is available, and the default of 2 is the sentence's job, not the value's
		expect(findField({ sections: view.sections, key: 'implement' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('shows the docs block whole in its own area, so a declared surface and what it covers are both on the page', async () => {
		const docs = [
			{ path: 'README.md', covers: 'The product tour and the index of every other document.' },
			{ path: 'docs/configuration.md', covers: 'Every configuration key.' },
		];
		const cwd = await seedConfiguredCwd({ config: { docs } });

		const view = await getConfigView({ cwd });

		const docsSection = view.sections.find((section) => section.title === 'Docs');

		expect(docsSection?.fields).toEqual([
			// the sentence is the schema's own, so the page and the config reference
			// cannot say different things about the same block
			expect.objectContaining({ key: 'docs', value: docs, fromConfig: true, description: expect.stringContaining('covers') }),
		]);
	});

	test('leaves docs null when the file omits it, because the block is opt-in and the engine fills nothing in for it', async () => {
		const cwd = await seedConfiguredCwd();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'docs' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});
});
