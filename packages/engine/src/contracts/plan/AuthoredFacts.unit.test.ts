import { expect, test } from '@jest/globals';
import { AuthoredFacts } from '@/contracts';

const area = {
	area: 'engine plan pipeline',
	namingConvention: 'run<X> functions, one export per file',
};

test('AuthoredFacts: a full authored shape parses with sparse area fields defaulted', () => {
	const parsed = AuthoredFacts.parse({
		request: 'add a verify-facts subcommand',
		areas: [area],
	});

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

test('AuthoredFacts: areas defaults to empty when omitted', () => {
	const parsed = AuthoredFacts.parse({ request: 'a request with no areas yet' });

	expect(parsed.areas).toStrictEqual([]);
});

test('AuthoredFacts: an already-stamped facts.json still parses, with the stamp stripped', () => {
	const parsed = AuthoredFacts.parse({
		request: 'a previously verified request',
		areas: [area],
		verification: { pathsChecked: 3, missingPaths: [], scriptsChecked: 1, missingScripts: [] },
		verifiedAt: '2026-07-09T00:00:00.000Z',
	});

	// unknown keys (verification, verifiedAt) are stripped — re-running
	// verify-facts on a stamped file is idempotent
	expect(Object.keys(parsed).sort()).toStrictEqual(['areas', 'request']);
});

test('AuthoredFacts: rejects a missing or non-string request', () => {
	// request is required — facts.json needs it downstream
	expect(AuthoredFacts.safeParse({ areas: [] }).success).toBe(false);
	expect(AuthoredFacts.safeParse({ request: 42, areas: [] }).success).toBe(false);
});

test('AuthoredFacts: rejects a malformed area entry', () => {
	const result = AuthoredFacts.safeParse({
		request: 'valid request',
		areas: [{ area: 'missing its namingConvention' }],
	});

	expect(result.success).toBe(false);
});
