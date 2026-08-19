import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('class-inheritance check', () => {
	test('asks for parsed trees, since the heritage clause is a fact of the declaration', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports a class that extends a base class', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/runs/RefactorRun.ts',
					[
						'export class RefactorRun extends RunState {',
						'\tdecline({ step }: { step: string }): void {',
						'\t\tthis.record({ step: `declined:${step}` });',
						'\t}',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'class-inheritance:src/runs/RefactorRun.ts',
				files: [{ path: 'src/runs/RefactorRun.ts' }],
				detail: "class 'RefactorRun' extends 'RunState'",
				guidance:
					'Share by composition: hold the common part as a value and delegate to it, or state the contract as an interface. `extends Error` is the one licensed base; a framework-mandated base is the judgment carve-out.',
			},
		]);
	});

	test('names the last segment of a qualified base, which is the word the convention rides on', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/charts/Chart.ts', ['export class Chart extends React.Component {', '\trender(): null {', '\t\treturn null;', '\t}', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("class 'Chart' extends 'Component'");
	});

	test('names the base of a generic extension without its type arguments', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/runs/RefactorRun.ts', ['export class RefactorRun extends RunState<string> {', '\tstep = 0;', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("class 'RefactorRun' extends 'RunState'");
	});

	test('falls back to the written text when the base is an expression rather than a name', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/runs/AuditedRun.ts', ['export class AuditedRun extends withAudit(RunState) {', '\tstep = 0;', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("class 'AuditedRun' extends 'withAudit(RunState)'");
	});

	test('names a default-exported class without a name as anonymous', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/runs/index.ts', ['export default class extends RunState {', '\tstep = 0;', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("class '(anonymous)' extends 'RunState'");
	});

	test.each([
		{ base: 'Error', licence: 'the platform’s one licensed base' },
		{ base: 'RunLockError', licence: 'an error-family chain' },
	])('leaves a class extending $base alone, which is $licence', async ({ base }) => {
		const input = setupSyntaxTreeInput({ sources: [['src/runs/StaleRunLockError.ts', `export class StaleRunLockError extends ${base} {}\n`]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a decorated class alone, since a framework-owned base is the framework’s decision', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/runs/RunResolver.ts',
					['@Resolver()', 'export class RunResolver extends BaseResolver {', '\tstep(): string {', "\t\treturn 'run';", '\t}', '}'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a class declared with no modifiers at all, where the decorator carve-out has nothing to look through', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/runs/runs.ts', ['class RefactorRun extends RunState {', '\tstep = 0;', '}'].join('\n')]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("class 'RefactorRun' extends 'RunState'");
	});

	test('leaves a class that only implements an interface, since a contract is not inheritance', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/runs/RefactorRun.ts',
					['export class RefactorRun implements RunRecorder {', '\trecord({ step }: { step: string }): void {', '\t\tvoid step;', '\t}', '}'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a class that declares no heritage at all', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/runs/RunState.ts', ['export class RunState {', '\tprivate steps: string[] = [];', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('gathers every offending class of one file into one job', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/runs/runs.ts',
					['export class RefactorRun extends RunState {', '\tstep = 0;', '}', '', 'export class CoverageRun extends RunState {', '\tstep = 1;', '}'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("class 'RefactorRun' extends 'RunState'; class 'CoverageRun' extends 'RunState'");
	});

	test('reports each offending file on its own and passes over the files that are clean', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/runs/RunLockError.ts', 'export class RunLockError extends Error {}\n'],
				['src/runs/RefactorRun.ts', ['export class RefactorRun extends RunState {', '\tstep = 0;', '}'].join('\n')],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'class-inheritance:src/runs/RefactorRun.ts',
				files: [{ path: 'src/runs/RefactorRun.ts' }],
				detail: "class 'RefactorRun' extends 'RunState'",
				guidance:
					'Share by composition: hold the common part as a value and delegate to it, or state the contract as an interface. `extends Error` is the one licensed base; a framework-mandated base is the judgment carve-out.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
