import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { resolveTrackerSettings } from '#src/ticketTracker/index.ts';

const trackerBlock = { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } as const;

const configOf = (tracker?: LightsoutConfig['ticket-tracker']): LightsoutConfig => ({
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	'ticket-tracker': tracker,
});

describe('resolveTrackerSettings', () => {
	test('answers the team and the key the named variable holds, which is all any tracker operation needs', () => {
		const settings = resolveTrackerSettings({ config: configOf({ ...trackerBlock }), env: { LINEAR_API_KEY: 'lin_key' } });

		expect(settings).toStrictEqual({ team: 'LO', apiKey: 'lin_key' });
	});

	test('reads the team and the key out of the block, so a repo naming another team and another variable is answered from its own config', () => {
		const settings = resolveTrackerSettings({
			config: configOf({ provider: 'linear', team: 'ACME', 'api-key-env': 'ACME_TRACKER_TOKEN' }),
			env: { ACME_TRACKER_TOKEN: 'acme_key', LINEAR_API_KEY: 'lin_key' },
		});

		expect(settings).toStrictEqual({ team: 'ACME', apiKey: 'acme_key' });
	});

	test('refuses a config with no ticket-tracker block, naming what the block has to say', () => {
		const settings = resolveTrackerSettings({ config: configOf(), env: {} });

		expect(settings).toStrictEqual({
			error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming provider, team and api-key-env',
		});
	});

	test('refuses a missing API key by naming the variable to set — a missing block and a missing key are two different things to fix', () => {
		const settings = resolveTrackerSettings({ config: configOf({ ...trackerBlock }), env: {} });

		expect(settings).toStrictEqual({ error: 'the tracker API key is missing: set the `LINEAR_API_KEY` environment variable' });
	});

	test('names the variable the block asked for in the missing-key refusal, so the sentence points at the config the repo actually wrote', () => {
		const settings = resolveTrackerSettings({
			config: configOf({ provider: 'linear', team: 'ACME', 'api-key-env': 'ACME_TRACKER_TOKEN' }),
			env: { LINEAR_API_KEY: 'lin_key' },
		});

		expect(settings).toStrictEqual({ error: 'the tracker API key is missing: set the `ACME_TRACKER_TOKEN` environment variable' });
	});

	test('treats an empty variable as absent, because an empty key authenticates nothing', () => {
		const settings = resolveTrackerSettings({ config: configOf({ ...trackerBlock }), env: { LINEAR_API_KEY: '' } });

		expect(settings).toStrictEqual({ error: 'the tracker API key is missing: set the `LINEAR_API_KEY` environment variable' });
	});
});
