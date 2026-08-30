import { describe, expect, test } from '@jest/globals';
import { type ConfigShip, LightsoutConfig } from '#src/contracts/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';

/** The smallest config the schema accepts, with whatever ship block the test is about. */
const setupConfig = ({ ship }: { ship?: ConfigShip } = {}) => {
	const config = LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, ...(ship === undefined ? {} : { ship }) });

	return { config };
};

describe('resolveShipSettings', () => {
	test('a config with no ship block still resolves, on the defaults the engine names', () => {
		const { config } = setupConfig();

		const settings = resolveShipSettings({ config });

		expect(settings).toEqual(expect.objectContaining({ pullRequestBody: '{ticket}', mergeMethod: 'merge', afterImplement: false, preShip: undefined }));
		expect({ ...settings?.ticketPattern.exec('lo-60-ship')?.groups }).toStrictEqual({ ticket: 'lo-60' });
	});

	test('a configured block wins over every default, compiled pattern included', () => {
		const { config } = setupConfig({
			ship: {
				'ticket-pattern': '^(?<ticket>ENG-(?<number>\\d+))',
				'pr-body': 'Closes {ticket}',
				'merge-method': 'squash',
				'after-implement': true,
				'pre-ship': 'node scripts/preShip.mjs',
			},
		});

		const settings = resolveShipSettings({ config });

		expect(settings).toEqual(
			expect.objectContaining({ pullRequestBody: 'Closes {ticket}', mergeMethod: 'squash', afterImplement: true, preShip: 'node scripts/preShip.mjs' }),
		);
		expect({ ...settings?.ticketPattern.exec('ENG-7-thing')?.groups }).toStrictEqual({ ticket: 'ENG-7', number: '7' });
	});

	test('a pattern that is not a regular expression at all answers undefined, so the caller can name the key once at startup', () => {
		const { config } = setupConfig({ ship: { 'ticket-pattern': '^(?<ticket>[a-z' } });

		const settings = resolveShipSettings({ config });

		expect(settings).toBe(undefined);
	});

	test('a valid pattern capturing no ticket group answers undefined, because it would make every branch unshippable', () => {
		const { config } = setupConfig({ ship: { 'ticket-pattern': '^[a-z]+-\\d+' } });

		const settings = resolveShipSettings({ config });

		expect(settings).toBe(undefined);
	});
});
