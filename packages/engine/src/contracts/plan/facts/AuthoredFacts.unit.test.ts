import { describe, expect, test } from '@jest/globals';
import { AuthoredFacts } from '#src/contracts/index.ts';

const setupFacts = (overrides: Record<string, unknown> = {}) => {
	const area = {
		area: 'engine plan pipeline',
		namingConvention: 'run<X> functions, one export per file',
	};
	const facts = {
		request: 'add a verify-facts subcommand',
		areas: [area],
		...overrides,
	};

	return { facts };
};

describe('AuthoredFacts', () => {
	test('a full authored shape parses with sparse area fields defaulted', () => {
		const { facts } = setupFacts();

		const parsed = AuthoredFacts.parse(facts);

		expect(parsed.request).toBe('add a verify-facts subcommand');
		// sparse area array fields default to empty — a minimal authored area still
		// parses
		expect(parsed.areas[0]).toStrictEqual({
			area: 'engine plan pipeline',
			affectedPackages: [],
			filesToModify: [],
			patternsToMirror: [],
			integrationPoints: [],
			scripts: [],
			namingConvention: 'run<X> functions, one export per file',
		});
	});

	test('areas defaults to empty when omitted', () => {
		const { facts } = setupFacts({ request: 'a request with no areas yet', areas: undefined });

		const parsed = AuthoredFacts.parse(facts);

		expect(parsed.areas).toStrictEqual([]);
	});

	test('an already-stamped facts.json still parses, with the stamp stripped', () => {
		const { facts } = setupFacts({
			request: 'a previously verified request',
			verification: { pathsChecked: 3, missingPaths: [], scriptsChecked: 1, missingScripts: [] },
			verifiedAt: '2026-07-09T00:00:00.000Z',
		});

		const parsed = AuthoredFacts.parse(facts);

		// unknown keys (verification, verifiedAt) are stripped — re-running
		// verify-facts on a stamped file is idempotent
		expect(Object.keys(parsed).sort()).toStrictEqual(['areas', 'request']);
	});

	test('rejects a missing request', () => {
		const { facts } = setupFacts({ request: undefined, areas: [] });

		const result = AuthoredFacts.safeParse(facts);

		// request is required — facts.json needs it downstream
		expect(result.success).toBe(false);
	});

	test('rejects a non-string request', () => {
		const { facts } = setupFacts({ request: 42, areas: [] });

		const result = AuthoredFacts.safeParse(facts);

		expect(result.success).toBe(false);
	});

	test('rejects a malformed area entry', () => {
		const { facts } = setupFacts({ request: 'valid request', areas: [{ area: 'missing its namingConvention' }] });

		const result = AuthoredFacts.safeParse(facts);

		expect(result.success).toBe(false);
	});
});
