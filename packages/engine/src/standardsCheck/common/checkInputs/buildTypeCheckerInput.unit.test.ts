import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { buildTypeCheckerInput } from '#src/standardsCheck/common/checkInputs/buildTypeCheckerInput.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';

interface SetupParams {
	/** Written at the repo root when given; omitted to make a repo no config covers. */
	tsconfig?: string;
}

const setupRepo = ({ tsconfig = '{"compilerOptions":{"strict":true,"noEmit":true},"include":["src"]}' }: SetupParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-type-checker-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'package.json'), '{ "name": "consumer" }\n');
	writeFileSync(join(cwd, 'src/kind.ts'), "export const Kind = { Added: 'added' } as const;\nexport type Kind = (typeof Kind)[keyof typeof Kind];\n");
	writeFileSync(join(cwd, 'src/event.ts'), "import type { Kind } from './kind';\n\nexport const kindOf = (kind: Kind): Kind => kind;\n");

	if (tsconfig !== '') {
		writeFileSync(join(cwd, 'tsconfig.json'), tsconfig);
	}

	return { cwd };
};

// The engine never bundles a compiler; this suite borrows the one the repo it
// runs in already has, exactly as a run borrows the consumer's.
const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

const buildInput = ({ cwd, source }: { cwd: string; source: string[] }) => {
	expectDefined(compiler);

	return buildTypeCheckerInput({ cwd, source, tests: [], files: source, referenceFiles: source, standardsPacks: [], compiler, packagesDir: 'packages' });
};

describe('buildTypeCheckerInput', () => {
	test('hands each source file a checker that resolves a type declared in another file', async () => {
		const { cwd } = setupRepo();

		const input = await buildInput({ cwd, source: ['src/kind.ts', 'src/event.ts'] });
		const entry = input.typedFiles.get('src/event.ts');

		expect(input.kind).toBe('type-checker');
		expectDefined(entry);
		// An import the program could not resolve types as `any` and reports
		// nothing rather than failing, so naming the resolved type is what tells a
		// working program from a broken one.
		const [declaration] = entry.sourceFile.statements.filter((statement) => compiler?.isVariableStatement(statement));
		const name = compiler?.isVariableStatement(declaration) ? declaration.declarationList.declarations[0]?.name : undefined;

		expectDefined(name);
		// The literal comes from the const object in the OTHER file. An import the
		// program failed to resolve would read `(kind: any) => any` here.
		expect(entry.checker.typeToString(entry.checker.getTypeAtLocation(name))).toBe('(kind: "added") => "added"');
	});

	test('leaves out a file no tsconfig covers rather than typing it against the wrong one', async () => {
		const { cwd } = setupRepo({ tsconfig: '' });

		const input = await buildInput({ cwd, source: ['src/kind.ts'] });

		// A checker built from the wrong options resolves imports to nothing and
		// answers `any` for everything, which a rule reads as "no finding here".
		expect(input.typedFiles.size).toBe(0);
	});

	test('a tsconfig that will not parse leaves its files untyped rather than failing the run', async () => {
		const { cwd } = setupRepo({ tsconfig: 'not json at all' });

		const input = await buildInput({ cwd, source: ['src/kind.ts'] });

		expect(input.typedFiles.size).toBe(0);
	});

	test('a source file the config excludes is left out, though the config itself parsed', async () => {
		const { cwd } = setupRepo({ tsconfig: '{"compilerOptions":{"strict":true,"noEmit":true},"include":["src/kind.ts"]}' });

		const input = await buildInput({ cwd, source: ['src/kind.ts', 'src/event.ts'] });

		expect([...input.typedFiles.keys()]).toStrictEqual(['src/kind.ts']);
	});

	test('carries the declared dependencies, so a typed rule can honour a framework carve-out', async () => {
		const { cwd } = setupRepo();

		const input = await buildInput({ cwd, source: ['src/kind.ts'] });

		expect(input.dependencies.has('.')).toBe(true);
	});
});
