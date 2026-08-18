import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('index-not-barrel check', () => {
	test('asks for parsed trees, since a multi-line re-export block defeats any line scan', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports an index file that grew into a program, counting its statements and naming the first line', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/cli/index.ts',
					["import { doctorCommand } from './doctorCommand';", '', 'const commands = { doctor: doctorCommand };', '', 'await commands.doctor();'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'index-not-barrel:src/cli/index.ts',
				files: [{ path: 'src/cli/index.ts' }],
				detail: '3 statement(s) other than re-export lines, the first at line 1',
				guidance: 'An index file is the module’s doorway — re-export lines only. Executable code belongs in a named entry file such as main.ts.',
			},
		]);
	});

	test('leaves a pure barrel alone, the multi-line type re-export and comments included', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/doctor/index.ts',
					[
						'// The doctor module’s public surface.',
						"export { runDoctor } from './runDoctor';",
						'export type {',
						'\tDoctorReport,',
						"} from './DoctorReport';",
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves `export *` to barrel-star — how a barrel re-exports is that rule’s objection', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/feature/index.ts', "export * from './renderGreeting';"]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a src root index holding code — the doorway rule has no root exemption', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/index.ts', "console.log('boot');"]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'index-not-barrel:src/index.ts',
				files: [{ path: 'src/index.ts' }],
				detail: '1 statement(s) other than re-export lines, the first at line 1',
				guidance: 'An index file is the module’s doorway — re-export lines only. Executable code belongs in a named entry file such as main.ts.',
			},
		]);
	});

	test('spares an index under common/, whose very existence is another rule’s objection', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/billing/common/utils/index.ts', "console.log('boot');"]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('says nothing about a named entry file, which is exactly where the code belongs', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/main.ts', ["import { runDoctor } from './doctor';", '', 'await runDoctor();'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
