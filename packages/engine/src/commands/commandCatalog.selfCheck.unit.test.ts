import { describe, expect, test } from '@jest/globals';
import { commandCatalog } from '#src/commands/index.ts';

const setupCatalog = () => {
	const byId = new Map(commandCatalog.map((entry) => [entry.id, entry]));

	return { byId };
};

describe('commandCatalog self-check', () => {
	test('gives the self-check its own Build-group entry, so its flags are accepted rather than rejected as unknown', () => {
		const { byId } = setupCatalog();

		const selfCheck = byId.get('self-check');

		expect(selfCheck).toEqual(
			expect.objectContaining({
				id: 'self-check',
				cli: 'lightsout self-check',
				group: 'build',
				invocations: [{ id: 'self-check' }],
				steps: [],
				records: 'nothing',
			}),
		);
		// no slash form, because the plugin ships no skill for it, and no infographic
		expect(selfCheck?.slash).toBeUndefined();
		expect(selfCheck?.graphic).toBeUndefined();
	});

	test('accepts only --run and --cwd on the self-check, so an appended flag can never widen it', () => {
		const { byId } = setupCatalog();

		const flags = byId.get('self-check')?.flags.map((flag) => [flag.name, flag.value, flag.required]);

		expect(flags).toStrictEqual([
			['run', '<id>', true],
			['cwd', '<path>', false],
		]);
	});

	test('pairs the self-check with every other Build command in both directions', () => {
		const { byId } = setupCatalog();
		const neighbours = ['brainstorm', 'plan', 'auto-plan', 'implement', 'implement-direct', 'resume', 'ship', 'queue', 'work-order', 'ticket-state'];

		const named = [...(byId.get('self-check')?.related ?? [])].sort();
		const silentBack = neighbours.filter((id) => byId.get(id)?.related.includes('self-check') !== true);

		expect(named).toStrictEqual([...neighbours].sort());
		expect(silentBack).toStrictEqual([]);
	});
});
