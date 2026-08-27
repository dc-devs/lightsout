import { describe, expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';
import { configKeyDescriptions } from '#src/views/common/constants/configKeyDescriptions.ts';

/** The smallest config the schema accepts, so adding one key is what decides whether a parse fails. */
const baseConfig = { gates: { check: 'pnpm check', test: 'pnpm test', 'test-coverage': 'pnpm coverage' } };

/** Whether the schema refuses this key outright — which is what every removed spelling's tombstone does. */
const isTombstone = ({ key }: { key: string }) => !LightsoutConfig.safeParse({ ...baseConfig, [key]: 'x' }).success;

/** The two rows the page splits the `timeouts` block into; each has its own default, so each needs its own sentence. */
const timeoutLeafKeys = ['timeouts.agent-minutes', 'timeouts.supervisor-minutes'];

describe('configKeyDescriptions', () => {
	test('explains every key a config may still write, so a new live key cannot ship without a sentence', () => {
		const uncovered = Object.keys(LightsoutConfig.shape).filter((key) => configKeyDescriptions[key] === undefined);

		expect(uncovered.filter((key) => !isTombstone({ key }))).toStrictEqual([]);
	});

	test('leaves the removed spellings out, because a key nobody may write needs no explanation', () => {
		const uncovered = Object.keys(LightsoutConfig.shape).filter((key) => configKeyDescriptions[key] === undefined);

		expect(uncovered.length).toBeGreaterThan(0);
	});

	test('describes nothing the schema does not declare, apart from the two timeout leaves the page gives their own rows', () => {
		const declared = new Set([...Object.keys(LightsoutConfig.shape), ...timeoutLeafKeys]);

		expect(Object.keys(configKeyDescriptions).filter((key) => !declared.has(key))).toStrictEqual([]);
	});

	test('gives each timeout leaf its own sentence rather than repeating the block’s', () => {
		expect(new Set(timeoutLeafKeys.map((key) => configKeyDescriptions[key])).size).toBe(2);
	});
});
