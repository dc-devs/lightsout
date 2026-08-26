import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { buildCloneSpansInput } from '#src/standardsCheck/common/checkInputs/buildCloneSpansInput.ts';

// Well past the detector's floor (50 tokens / 5 lines) so the duplicated span
// is unambiguously a duplicate block.
const bigBody = `
	let total = 0;
	for (const record of records) {
		if (record.active && record.amount > 0) {
			total += record.amount * record.multiplier + record.bonus;
		} else if (record.pending) {
			total += record.amount / 2 - record.fee;
		} else {
			total -= record.penalty ?? 0;
		}
	}
	return total * 100;
`;

// A shared import block in every style the blanking recognises — side-effect
// imports with no `from`, a multi-line named import, single-line named imports,
// a default import. On its own it clears the detector's floor (50 tokens over
// 5 lines), so leaving it in the text would report it as a duplicate block.
const sharedImports = `import './register-metrics';
import './register-logging';
import {
	alphaOne,
	alphaTwo,
	alphaThree,
	alphaFour,
	alphaFive,
} from './shared-one';
import { betaOne, betaTwo, betaThree, betaFour, betaFive } from './shared-two';
import { gammaOne, gammaTwo, gammaThree, gammaFour, gammaFive } from './shared-three';
import defaultThing from './shared-four';`;

const setupRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-clone-spans-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), `import { one } from './one';\n\nexport const alpha = ({ records }: { records: any[] }) => {${bigBody}};\n`);
	writeFileSync(join(cwd, 'src/beta.ts'), `import { one } from './one';\n\nexport const beta = ({ records }: { records: any[] }) => {${bigBody}};\n`);

	return { cwd };
};

const setupJavascriptRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-clone-spans-js-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.js'), `import { one } from './one.js';\n\nexport const alpha = ({ records }) => {${bigBody}};\n`);
	writeFileSync(join(cwd, 'src/beta.js'), `import { one } from './one.js';\n\nexport const beta = ({ records }) => {${bigBody}};\n`);

	return { cwd };
};

// Two files whose only shared text is the import block; their bodies differ.
const setupSharedImportRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-clone-spans-imports-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), `${sharedImports}\n\nexport const alpha = ({ records }: { records: number[] }) => records.length;\n`);
	writeFileSync(join(cwd, 'src/beta.ts'), `${sharedImports}\n\nexport const beta = ({ names }: { names: string[] }) => names.join(', ');\n`);

	return { cwd };
};

// The same duplicated body in both files, but beta's import block is four lines
// longer — so beta's copy genuinely sits four lines lower than alpha's.
const setupOffsetImportRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-clone-spans-offset-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), `import { one } from './one';\n\nexport const alpha = ({ records }: { records: any[] }) => {${bigBody}};\n`);
	writeFileSync(
		join(cwd, 'src/beta.ts'),
		`import {\n\tone,\n\ttwo,\n\tthree,\n} from './one';\n\nexport const beta = ({ records }: { records: any[] }) => {${bigBody}};\n`,
	);

	return { cwd };
};

describe('buildCloneSpansInput', () => {
	test('reports each duplicated span with both of its sites and its token count', async () => {
		const { cwd } = setupRepo();

		const input = await buildCloneSpansInput({ cwd, source: ['src/alpha.ts', 'src/beta.ts'], settings: { minTokens: 50 }, cache: new Map() });
		const span = input.spans[0];

		expect(input.kind).toBe('clone-spans');
		expect(input.spans).toHaveLength(1);
		expect(span?.files.map((file) => file.path).sort()).toStrictEqual(['src/alpha.ts', 'src/beta.ts']);
		expect(span?.tokens).toBeGreaterThanOrEqual(50);
		// the spans are line ranges a reader can open
		expect(span?.files[0]?.startLine).toBeGreaterThan(0);
	});

	test('honors the asking rule minTokens, because the engine runs the detector', async () => {
		const { cwd } = setupRepo();

		const input = await buildCloneSpansInput({ cwd, source: ['src/alpha.ts', 'src/beta.ts'], settings: { minTokens: 5000 }, cache: new Map() });

		// nothing in the fixture is 5000 tokens long
		expect(input.spans).toStrictEqual([]);
	});

	test('skips a source file it cannot read instead of abandoning the detection', async () => {
		const { cwd } = setupRepo();

		const input = await buildCloneSpansInput({
			cwd,
			source: ['src/ghost.ts', 'src/alpha.ts', 'src/beta.ts'],
			settings: { minTokens: 50 },
			cache: new Map(),
		});

		expect(input.spans).toHaveLength(1);
	});

	test('detects clones in plain javascript sources as well as typescript ones', async () => {
		const { cwd } = setupJavascriptRepo();

		const input = await buildCloneSpansInput({ cwd, source: ['src/alpha.js', 'src/beta.js'], settings: { minTokens: 50 }, cache: new Map() });

		expect(input.spans[0]?.files.map((file) => file.path).sort()).toStrictEqual(['src/alpha.js', 'src/beta.js']);
	});

	test('never reports a shared import block as duplication', async () => {
		const { cwd } = setupSharedImportRepo();

		const input = await buildCloneSpansInput({ cwd, source: ['src/alpha.ts', 'src/beta.ts'], settings: { minTokens: 50 }, cache: new Map() });

		expect(input.spans).toStrictEqual([]);
	});

	test('reports the true line numbers of code that follows an import block', async () => {
		const { cwd } = setupOffsetImportRepo();

		const input = await buildCloneSpansInput({ cwd, source: ['src/alpha.ts', 'src/beta.ts'], settings: { minTokens: 50 }, cache: new Map() });
		const [alphaLine = 0, betaLine = 0] = ['src/alpha.ts', 'src/beta.ts'].map(
			(path) => input.spans[0]?.files.find((file) => file.path === path)?.startLine ?? 0,
		);

		// alpha's body cannot start before line 3, and beta's sits four lines
		// lower — an offset that only survives if the imports were blanked in
		// place rather than removed.
		expect(alphaLine).toBeGreaterThanOrEqual(3);
		expect(betaLine - alphaLine).toBe(4);
	});
});

// The composition remedy's shape: an assigning constructor and chunky one-line
// forwards to the held collaborator. Two classes holding the same collaborator
// share all of it by design, and together the members clear the detector's
// floor (50 tokens over 5 lines).
const delegatingClass = ({ name }: { name: string }) => `export class ${name} {
	private readonly runState: RunState;

	constructor({ runState }: { runState: RunState }) {
		this.runState = runState;
	}

	update({ patch, reason, actor, timestamp }: { patch: object; reason: string; actor: string; timestamp: number }): Promise<void> {
		return this.runState.update({ patch, reason, actor, timestamp });
	}

	setStep({ step, index, total, label }: { step: string; index: number; total: number; label: string }): Promise<void> {
		return this.runState.setStep({ step, index, total, label });
	}
}
`;

const setupDelegatingRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-clone-spans-delegate-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/RefactorRun.ts'), delegatingClass({ name: 'RefactorRun' }));
	writeFileSync(join(cwd, 'src/PipelineRun.ts'), delegatingClass({ name: 'PipelineRun' }));

	return { cwd };
};

describe('buildCloneSpansInput delegation blanking', () => {
	test('two classes sharing only the composition remedy produce no span when a compiler is present', async () => {
		const { cwd } = setupDelegatingRepo();
		const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

		const input = await buildCloneSpansInput({
			cwd,
			source: ['src/RefactorRun.ts', 'src/PipelineRun.ts'],
			settings: { minTokens: 50 },
			cache: new Map(),
			compiler,
		});

		expect(input.spans).toStrictEqual([]);
	});

	test('without a compiler the blanking is skipped rather than guessed, so the spans come back', async () => {
		const { cwd } = setupDelegatingRepo();

		const input = await buildCloneSpansInput({ cwd, source: ['src/RefactorRun.ts', 'src/PipelineRun.ts'], settings: { minTokens: 50 }, cache: new Map() });

		expect(input.spans.length).toBeGreaterThan(0);
	});
});
