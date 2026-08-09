import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** A repo as the engine hands it to a file-text rule: every path in scope, with its text. */
const setupFileTextInput = ({ contents }: { contents: Array<[string, string]> }): StandardsCheckInput => {
	const files = contents.map(([path]) => path);

	return {
		kind: StandardsInputKind.FileText,
		cwd: '/repo',
		source: files,
		tests: files.filter((path) => path.includes('.test.')),
		files,
		referenceFiles: [],
		contents: new Map(contents),
	};
};

/** The input a rule that did NOT declare `file-text` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/feature/buildGreeting.ts'],
	spans: [],
});

describe('dead-export check', () => {
	test('asks for file text, since the verdict counts mentions across the repo', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports an export no module, barrel or test mentions', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/index.ts', "export { renderGreeting } from './renderGreeting';"],
				['src/feature/renderGreeting.ts', 'export const renderGreeting = ({ name }: { name: string }): string => `<p>${name}</p>`;'],
				['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'dead-export:src/feature/buildGreeting.ts',
				files: [{ path: 'src/feature/buildGreeting.ts' }],
				detail: "'buildGreeting' is referenced nowhere else",
				guidance: 'A dead code candidate. Delete it — version control has the history.',
			},
		]);
	});

	test('leaves alone an export a barrel or a test still reaches — those are other rules’ verdicts', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/index.ts', "export { renderGreeting } from './renderGreeting';"],
				['src/feature/renderGreeting.ts', 'export const renderGreeting = ({ name }: { name: string }): string => `<p>${name}</p>`;'],
				['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;'],
				['src/feature/buildGreeting.unit.test.ts', "import { buildGreeting } from './buildGreeting';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
