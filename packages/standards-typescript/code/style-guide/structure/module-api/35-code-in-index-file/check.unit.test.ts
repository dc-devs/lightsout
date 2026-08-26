import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('code-in-index-file check', () => {
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
				siteKey: 'code-in-index-file:src/cli/index.ts',
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

	test('reports an index that imports and re-exports separately, since neither line is a re-export line', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/reporting/index.ts', ["import { buildReport } from './buildReport';", '', 'export { buildReport };'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'code-in-index-file:src/reporting/index.ts',
				files: [{ path: 'src/reporting/index.ts' }],
				detail: '2 statement(s) other than re-export lines, the first at line 1',
				guidance: 'An index file is the module’s doorway — re-export lines only. Executable code belongs in a named entry file such as main.ts.',
			},
		]);
	});

	test('reports a component barrel named index.tsx, which is an index file like any other', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/features/Dashboard/index.tsx', 'export const Dashboard = () => <section />;']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'code-in-index-file:src/features/Dashboard/index.tsx',
				files: [{ path: 'src/features/Dashboard/index.tsx' }],
				detail: '1 statement(s) other than re-export lines, the first at line 1',
				guidance: 'An index file is the module’s doorway — re-export lines only. Executable code belongs in a named entry file such as main.ts.',
			},
		]);
	});

	test('reports a src root index holding code — the doorway rule has no root exemption', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/index.ts', "console.log('boot');"]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'code-in-index-file:src/index.ts',
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

	test('spares an index route file — a file-based router mandates it and forbids it being a barrel', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'packages/web-app/src/routes/index.tsx',
					["import { createFileRoute } from '@tanstack/react-router';", '', "export const Route = createFileRoute('/')({ component: Home });"].join('\n'),
				],
			],
			dependencies: [['packages/web-app', ['@tanstack/react-router']]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('still judges an index outside the router root in a package that has a router', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['packages/web-app/src/features/index.ts', "console.log('boot');"]],
			dependencies: [['packages/web-app', ['@tanstack/react-router']]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'code-in-index-file:packages/web-app/src/features/index.ts',
				files: [{ path: 'packages/web-app/src/features/index.ts' }],
				detail: '1 statement(s) other than re-export lines, the first at line 1',
				guidance: 'An index file is the module’s doorway — re-export lines only. Executable code belongs in a named entry file such as main.ts.',
			},
		]);
	});

	test('a routes folder in a package with no router earns no exemption', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['packages/api/src/routes/index.ts', "console.log('boot');"]],
			dependencies: [['packages/api', ['zod']]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'code-in-index-file:packages/api/src/routes/index.ts',
				files: [{ path: 'packages/api/src/routes/index.ts' }],
				detail: '1 statement(s) other than re-export lines, the first at line 1',
				guidance: 'An index file is the module’s doorway — re-export lines only. Executable code belongs in a named entry file such as main.ts.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
