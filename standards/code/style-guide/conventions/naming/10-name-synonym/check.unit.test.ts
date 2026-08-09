import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** A repo as the engine hands it to a file-list rule — paths only, nothing opened. */
const setupFileListInput = ({ files, tests = [] }: { files: string[]; tests?: string[] }): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source: files.filter((file) => !tests.includes(file)),
	tests,
	files,
	referenceFiles: [],
	dependencies: new Map<string, string[]>(),
});

/** The input a rule that did NOT declare `file-list` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/users/getUserData.ts'],
	spans: [],
});

describe('name-synonym check', () => {
	test('asks for the file list, since every name it compares is already in the paths', () => {
		expect(check.inputKind).toBe('file-list');
	});

	test('reports two names that differ only by a banned synonym', async () => {
		const input = setupFileListInput({ files: ['src/profile/getUserData.ts', 'src/users/fetchUserData.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'name-synonym:src/profile/getUserData.ts|src/users/fetchUserData.ts',
				files: [{ path: 'src/profile/getUserData.ts' }, { path: 'src/users/fetchUserData.ts' }],
				detail: "'getUserData', 'fetchUserData' differ only by synonym or word order",
				guidance: 'Likely one concept living under two names.',
			},
		]);
	});

	test('reports two names that differ only by word order', async () => {
		const input = setupFileListInput({ files: ['src/users/getUserData.ts', 'src/users/userDataGet.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'name-synonym:src/users/getUserData.ts|src/users/userDataGet.ts',
				files: [{ path: 'src/users/getUserData.ts' }, { path: 'src/users/userDataGet.ts' }],
				detail: "'getUserData', 'userDataGet' differ only by synonym or word order",
				guidance: 'Likely one concept living under two names.',
			},
		]);
	});

	test('names every file behind each spelling, so the work is one job across both sites', async () => {
		const input = setupFileListInput({
			files: ['src/admin/fetchUserData.ts', 'src/profile/getUserData.ts', 'src/users/fetchUserData.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.files).toStrictEqual([
			{ path: 'src/admin/fetchUserData.ts' },
			{ path: 'src/users/fetchUserData.ts' },
			{ path: 'src/profile/getUserData.ts' },
		]);
	});

	test('leaves two genuinely different names alone', async () => {
		const input = setupFileListInput({ files: ['src/users/getUserData.ts', 'src/users/getUserRoles.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('spares a framework pair — one name spelled for a component and for the route that renders it', async () => {
		const input = setupFileListInput({ files: ['src/routes/get-started.ts', 'src/screens/GetStarted.tsx'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reads a component file as the name it exports, so the exemption above is a decision rather than a name it never saw', async () => {
		const input = setupFileListInput({ files: ['src/screens/FetchUserData.tsx', 'src/users/getUserData.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'name-synonym:src/screens/FetchUserData.tsx|src/users/getUserData.ts',
				files: [{ path: 'src/screens/FetchUserData.tsx' }, { path: 'src/users/getUserData.ts' }],
				detail: "'FetchUserData', 'getUserData' differ only by synonym or word order",
				guidance: 'Likely one concept living under two names.',
			},
		]);
	});

	test('spares opposite conversions, whose word order is the whole point', async () => {
		const input = setupFileListInput({ files: ['src/color/hexToRgb.ts', 'src/color/rgbToHex.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores barrels, whose name says nothing about what the file holds', async () => {
		const input = setupFileListInput({ files: ['src/users/index.ts', 'src/profile/index.ts'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores test files, which are named after the subject they cover', async () => {
		const input = setupFileListInput({
			files: ['src/users/getUserData.ts', 'src/users/getUserData.unit.test.ts', 'src/admin/fetchUserData.unit.test.ts'],
			tests: ['src/users/getUserData.unit.test.ts', 'src/admin/fetchUserData.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
