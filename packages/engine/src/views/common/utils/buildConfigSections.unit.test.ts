import { describe, expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';
import { configKeyDescriptions } from '#src/views/common/constants/configKeyDescriptions.ts';
import { buildConfigSections } from '#src/views/common/utils/buildConfigSections.ts';

/** The queue block this repo's own config shape allows, used to prove the section reads the file rather than a default. */
const queueBlock = {
	'planning-status-labels': { 'planning-complete': 'shaped' },
	'max-parallel': 3,
};

/** The tracker block beside it — identity is its own block, so it is its own section too. */
const ticketTrackerBlock = {
	provider: 'linear',
	team: 'LO',
	'api-key-env': 'LINEAR_API_KEY',
};

/** A parsed config, so the sections are built from the same value a run would hand them. */
const buildSections = ({ config = {} }: { config?: Record<string, unknown> } = {}) =>
	buildConfigSections({
		config: LightsoutConfig.parse({ gates: { check: 'pnpm check', test: 'pnpm test', 'test-coverage': 'pnpm coverage' }, ...config }),
		declaredKeys: Object.keys(config),
	});

/** Every key the page emits, across all its sections. */
const emittedKeys = () => buildSections().flatMap((section) => section.fields.map((field) => field.key));

describe('buildConfigSections', () => {
	test('gives every described key a row of its own, so a key with a sentence cannot go missing from the page', () => {
		// `timeouts` is the one described key with no row of its own: the page shows
		// its two leaves instead, because the block's two defaults are per leaf.
		const described = Object.keys(configKeyDescriptions).filter((key) => key !== 'timeouts');

		expect([...emittedKeys()].sort()).toStrictEqual([...described].sort());
	});

	test('emits no key the constant does not describe, which is what keeps every row’s sentence non-empty', () => {
		expect(emittedKeys().filter((key) => configKeyDescriptions[key] === undefined)).toStrictEqual([]);
	});

	test('reads the queue block back into a Queue section, rather than leaving the block the document documents off the page', () => {
		const queue = buildSections({ config: { queue: queueBlock } }).find((section) => section.title === 'Queue');

		expect(queue?.fields).toStrictEqual([{ key: 'queue', value: queueBlock, fromConfig: true, description: configKeyDescriptions.queue }]);
	});

	test('leaves queue null when the file omits it, because the block is opt-in and the engine fills nothing in for it', () => {
		const queue = buildSections().find((section) => section.title === 'Queue');

		expect(queue?.fields[0]).toStrictEqual({ key: 'queue', value: null, fromConfig: false, description: configKeyDescriptions.queue });
	});

	test('reads the ticket-tracker block back into its own section, ahead of the queue block that consumes it', () => {
		const sections = buildSections({ config: { 'ticket-tracker': ticketTrackerBlock } });
		const tracker = sections.find((section) => section.title === 'Ticket tracker');

		expect(tracker?.fields).toStrictEqual([
			{ key: 'ticket-tracker', value: ticketTrackerBlock, fromConfig: true, description: configKeyDescriptions['ticket-tracker'] },
		]);
		expect(sections.findIndex((section) => section.title === 'Ticket tracker')).toBeLessThan(sections.findIndex((section) => section.title === 'Queue'));
	});

	test('leaves ticket-tracker null when the file omits it, because the engine runs with no tracker at all', () => {
		const tracker = buildSections().find((section) => section.title === 'Ticket tracker');

		expect(tracker?.fields[0]).toStrictEqual({
			key: 'ticket-tracker',
			value: null,
			fromConfig: false,
			description: configKeyDescriptions['ticket-tracker'],
		});
	});
});
