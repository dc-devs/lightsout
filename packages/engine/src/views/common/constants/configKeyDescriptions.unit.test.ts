import { describe, expect, test } from '@jest/globals';
import { z } from 'zod';
import { LightsoutConfig } from '#src/contracts/index.ts';
import { configKeyDescriptions } from '#src/views/common/constants/configKeyDescriptions.ts';

/** The schema's fields reachable by a key spelled as a string. */
const configSchemaFields: Record<string, z.ZodType> = LightsoutConfig.shape;

/**
 * Whether the schema declares this key as a never — which is what every removed
 * spelling's tombstone is, whether it was built by `renamedKey` or written out.
 *
 * Asked of the declaration rather than of a parse: probing with the string `'x'`
 * says "tombstone" for every object-shaped key too, so `queue`, `ship` and
 * `commands` were all excused from needing a sentence.
 */
const isTombstone = ({ key }: { key: string }) => {
	const field = configSchemaFields[key];
	const inner = field instanceof z.ZodOptional ? field.unwrap() : field;

	return inner instanceof z.ZodNever;
};

/** The rows the page splits the `timeouts` block into; each has its own default, so each needs its own sentence. */
const timeoutLeafKeys = ['timeouts.agent-minutes', 'timeouts.supervisor-minutes', 'timeouts.gate-minutes'];

describe('configKeyDescriptions', () => {
	test('explains every key a config may still write, so a new live key cannot ship without a sentence', () => {
		const uncovered = Object.keys(LightsoutConfig.shape).filter((key) => configKeyDescriptions[key] === undefined);

		expect(uncovered.filter((key) => !isTombstone({ key }))).toStrictEqual([]);
	});

	test('leaves the removed spellings out, because a key nobody may write needs no explanation', () => {
		const uncovered = Object.keys(LightsoutConfig.shape).filter((key) => configKeyDescriptions[key] === undefined);

		expect(uncovered.length).toBeGreaterThan(0);
	});

	test('describes nothing the schema does not declare, apart from the timeout leaves the page gives their own rows', () => {
		const declared = new Set([...Object.keys(LightsoutConfig.shape), ...timeoutLeafKeys]);

		expect(Object.keys(configKeyDescriptions).filter((key) => !declared.has(key))).toStrictEqual([]);
	});

	test('gives each timeout leaf its own sentence rather than repeating the block’s', () => {
		expect(new Set(timeoutLeafKeys.map((key) => configKeyDescriptions[key])).size).toBe(timeoutLeafKeys.length);
	});

	test('counts a block-shaped key as live, so `queue` cannot ship without a sentence the way it once did', () => {
		expect(isTombstone({ key: 'queue' })).toBe(false);
		expect(configKeyDescriptions.queue).toBeDefined();
	});
});
