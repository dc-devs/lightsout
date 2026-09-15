import { rm } from 'node:fs/promises';
import { afterEach, expect, test } from '@jest/globals';
import { collectSourceEvidence } from '#src/plan/evidence/index.ts';
import { planningEvidenceFixture } from '#tests/helpers/planningEvidenceFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async () => {
	const context = await planningEvidenceFixture();
	directories.push(context.cwd);
	return context;
};
test('requires explicit acquisition targets when no explorer facts are supplied', async () => {
	const { cwd, name } = await setup();

	await expect(collectSourceEvidence({ cwd, name })).rejects.toThrow(/facts or explicit targets/);
});
test('refuses missing supplied observations rather than rereading mutable source files', async () => {
	const { cwd, name } = await setup();

	await expect(collectSourceEvidence({ cwd, name, targets: [{ path: 'src/action.ts', role: 'Observed input' }], sourceBytes: new Map() })).rejects.toThrow(
		/Observed source bytes are missing/,
	);
});
const setupTargeted = async () => {
	const context = await setup();
	const targets = [
		{ path: 'src/one.ts', role: 'First investigation' },
		{ path: 'src/two.ts', role: 'Independent investigation' },
	];
	await collectSourceEvidence({
		cwd: context.cwd,
		name: context.name,
		targets,
		sourceBytes: new Map([
			['src/one.ts', 'original one'],
			['src/two.ts', 'original two'],
		]),
	});
	return context;
};
test('refreshes one acquisition while preserving unrelated observed bytes and all reasons', async () => {
	const { cwd, name } = await setupTargeted();

	const result = await collectSourceEvidence({
		cwd,
		name,
		targets: [{ path: 'src/one.ts', role: 'Follow-up investigation' }],
		sourceBytes: new Map([['src/one.ts', 'updated one']]),
	});

	expect(result.entries.map(({ path, text, roles }) => ({ path, text, roles }))).toStrictEqual([
		{ path: 'src/one.ts', text: 'updated one', roles: ['First investigation', 'Follow-up investigation'] },
		{ path: 'src/two.ts', text: 'original two', roles: ['Independent investigation'] },
	]);
	expect(result.acquisition).toStrictEqual({ version: 1, semantics: 'bytes-only', paths: ['src/one.ts'] });
});
