import assert from 'node:assert/strict';
import { test } from 'node:test';
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

	assert.equal(parsed.request, 'add a verify-facts subcommand');
	assert.deepEqual(
		parsed.areas[0],
		{
			area: 'engine plan pipeline',
			affectedPackages: [],
			filesToModify: [],
			patternsToMirror: [],
			integrationPoints: [],
			scripts: [],
			namingConvention: 'run<X> functions, one export per file',
		},
		'sparse area array fields default to empty — a minimal authored area still parses',
	);
});

test('AuthoredFacts: areas defaults to empty when omitted', () => {
	const parsed = AuthoredFacts.parse({ request: 'a request with no areas yet' });

	assert.deepEqual(parsed.areas, []);
});

test('AuthoredFacts: an already-stamped facts.json still parses, with the stamp stripped', () => {
	const parsed = AuthoredFacts.parse({
		request: 'a previously verified request',
		areas: [area],
		verification: { pathsChecked: 3, missingPaths: [], scriptsChecked: 1, missingScripts: [] },
		verifiedAt: '2026-07-09T00:00:00.000Z',
	});

	assert.deepEqual(
		Object.keys(parsed).sort(),
		['areas', 'request'],
		'unknown keys (verification, verifiedAt) are stripped — re-running verify-facts on a stamped file is idempotent',
	);
});

test('AuthoredFacts: rejects a missing or non-string request', () => {
	assert.equal(AuthoredFacts.safeParse({ areas: [] }).success, false, 'request is required — facts.json needs it downstream');
	assert.equal(AuthoredFacts.safeParse({ request: 42, areas: [] }).success, false);
});

test('AuthoredFacts: rejects a malformed area entry', () => {
	const result = AuthoredFacts.safeParse({
		request: 'valid request',
		areas: [{ area: 'missing its namingConvention' }],
	});

	assert.equal(result.success, false);
});
