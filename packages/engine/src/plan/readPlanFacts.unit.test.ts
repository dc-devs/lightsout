import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readPlanFacts } from '#src/plan/readPlanFacts.ts';

const setupWorkspace = ({ facts }: { facts?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-facts-'));

	if (facts !== undefined) {
		const dir = join(cwd, '.lightsout', 'plans', 'demo');

		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'facts.json'), facts);
	}

	return cwd;
};

describe('readPlanFacts', () => {
	test('returns the authored facts parsed against the contract', async () => {
		const cwd = setupWorkspace({
			facts: JSON.stringify({
				request: 'do a thing',
				areas: [],
				verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [], createPathsThatExist: [] },
				verifiedAt: '2026-01-01T00:00:00.000Z',
			}),
		});

		await expect(readPlanFacts({ cwd, name: 'demo' })).resolves.toEqual(expect.objectContaining({ request: 'do a thing' }));
	});

	test('a missing facts.json rejects pointing at plan verify-facts', async () => {
		// the message names the authoring step, so the caller is never left guessing
		await expect(readPlanFacts({ cwd: setupWorkspace(), name: 'demo' })).rejects.toThrow(/no facts found[\s\S]*plan verify-facts --name demo/);
	});

	test('a corrupt facts.json rejects rather than reading as empty facts', async () => {
		await expect(readPlanFacts({ cwd: setupWorkspace({ facts: '{ not json' }), name: 'demo' })).rejects.toThrow(SyntaxError);
	});
});
