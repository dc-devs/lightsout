import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** A repo as the engine hands it to a file-text rule: every path in scope, with its text beside it. */
const setupFileTextInput = ({ contents, tests = [] }: { contents: Array<[string, string]>; tests?: string[] }): StandardsCheckInput => {
	const files = contents.map(([path]) => path);

	return {
		kind: StandardsInputKind.FileText,
		cwd: '/repo',
		source: files.filter((file) => !tests.includes(file)),
		tests,
		files,
		referenceFiles: [],
		contents: new Map(contents),
	};
};

/** A file the engine listed in scope but whose text it could not read, so `contents` holds no entry for it. */
const setupUnreadableFileInput = ({ path }: { path: string }): StandardsCheckInput => ({
	kind: StandardsInputKind.FileText,
	cwd: '/repo',
	source: [path],
	tests: [],
	files: [path],
	referenceFiles: [],
	contents: new Map<string, string>(),
});

/** The input a rule that did NOT declare `file-text` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/billing/chargeLabel.ts'],
	spans: [],
});

describe('filename-mismatch check', () => {
	test('asks for file text, since the export it compares against is inside the file', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports a file whose only export is called something else', async () => {
		const input = setupFileTextInput({ contents: [['src/billing/chargeLabel.ts', 'export const getChargeLabel = (): number => 1;']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'filename-mismatch:src/billing/chargeLabel.ts',
				files: [{ path: 'src/billing/chargeLabel.ts' }],
				detail: "file 'chargeLabel' exports 'getChargeLabel'",
				guidance: 'The filename should match the export it holds.',
			},
		]);
	});

	test('accepts a file named after its export', async () => {
		const input = setupFileTextInput({ contents: [['src/billing/getChargeLabel.ts', 'export const getChargeLabel = (): number => 1;']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ path: 'src/events/events.service.ts', declaration: 'export class EventsService {', shape: 'a framework dot-suffix' },
		{ path: 'src/users/user.model.ts', declaration: 'export class User {', shape: 'an export named for the part before a framework dot-suffix' },
		{ path: 'src/routes/get-started.ts', declaration: 'export const getStarted = (): number => 1;', shape: 'a kebab-case route file' },
		{ path: 'src/components/UserProfile.tsx', declaration: 'export const UserProfile = (): null => null;', shape: 'a PascalCase component' },
	])('accepts $shape, whose casing the framework dictates', async ({ path, declaration }) => {
		const input = setupFileTextInput({ contents: [[path, declaration]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('stays silent on a file holding two exports, which the one-export-per-file rule owns', async () => {
		const input = setupFileTextInput({
			contents: [['src/config/config.ts', ['export interface Config {', '\tname: string;', '}', '', 'export const defaultConfig = { name: 1 };'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('stays silent on a file whose text the engine could not read', async () => {
		const input = setupUnreadableFileInput({ path: 'src/billing/chargeLabel.ts' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('stays silent on a file that exports no declaration of its own', async () => {
		const input = setupFileTextInput({ contents: [['src/billing/chargeLabel.ts', "export { getChargeLabel } from '@/billing/getChargeLabel';"]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores a barrel, which declares nothing of its own', async () => {
		const input = setupFileTextInput({ contents: [['src/billing/index.ts', 'export const getChargeLabel = (): number => 1;']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores a test file, which the test standards name after its subject', async () => {
		const input = setupFileTextInput({
			contents: [['src/billing/getChargeLabel.unit.test.ts', 'export const setupCharge = (): number => 1;']],
			tests: ['src/billing/getChargeLabel.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
