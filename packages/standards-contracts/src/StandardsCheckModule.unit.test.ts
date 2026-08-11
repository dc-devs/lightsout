import { describe, expect, test } from '@jest/globals';
import { StandardsCheckModule, StandardsInputKind } from './index.ts';

const setupModule = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const run = () => [];

	const checkModule: Record<string, unknown> = {
		inputKind: 'file-list',
		run,
		...extra,
	};

	if (omit) {
		delete checkModule[omit];
	}

	return { checkModule, run };
};

describe('StandardsCheckModule', () => {
	test('a check module parses with its declared input kind and the function the package shipped', () => {
		const { checkModule, run } = setupModule();

		const parsed = StandardsCheckModule.parse(checkModule);

		// the engine calls `run` itself, so the parsed value must be the very
		// function the package exported — not a copy or a wrapper
		expect(parsed).toStrictEqual({ inputKind: 'file-list', run });
	});

	test('every input the engine builds is a kind a check may declare', () => {
		for (const inputKind of ['file-list', 'file-text', 'syntax-tree', 'test-file', 'import-graph', 'clone-spans']) {
			const { checkModule } = setupModule({ extra: { inputKind } });

			const parsed = StandardsCheckModule.parse(checkModule);

			// ${inputKind} is the wire value a rule folder writes in its check file, and
			// the key the engine reads to decide which input to hand the check
			expect(parsed.inputKind).toBe(inputKind);
		}
	});

	test('the input-kind vocabulary is exactly those six wire values', () => {
		const inputKinds = [...Object.values(StandardsInputKind)].sort();

		// each kind names one input the engine has to build before any check runs —
		// a kind added or renamed without being restated here is an unreviewed
		// change to what package authors may write
		expect(inputKinds).toStrictEqual(['clone-spans', 'file-list', 'file-text', 'import-graph', 'syntax-tree', 'test-file']);
	});

	test('rejects an input kind outside the closed set', () => {
		for (const inputKind of ['file-lists', 'FileList', 'files', '']) {
			const { checkModule } = setupModule({ extra: { inputKind } });

			const result = StandardsCheckModule.safeParse(checkModule);

			// a kind nothing builds would leave the check with no input at all — the
			// load boundary refuses it while the package can still be named
			expect(result.success).toBe(false);
		}
	});

	test('rejects a check module that declares no input kind', () => {
		const { checkModule } = setupModule({ omit: 'inputKind' });

		const result = StandardsCheckModule.safeParse(checkModule);

		// without a kind the engine cannot know which input to build, so there is no
		// default to fall back to
		expect(result.success).toBe(false);
	});

	test('an async check parses — a run may return a promise of its findings', () => {
		const run = async () => [];
		const { checkModule } = setupModule({ extra: { run } });

		const parsed = StandardsCheckModule.parse(checkModule);

		// the call signature allows either; the schema only asks that it be callable
		expect(parsed.run).toBe(run);
	});

	test('rejects a run that is not callable', () => {
		for (const run of [{ inputKind: 'file-list' }, 'run', 42, null, [], undefined]) {
			const { checkModule } = setupModule({ extra: { run } });

			const result = StandardsCheckModule.safeParse(checkModule);

			// the engine invokes this value during a run — a non-function would throw
			// deep inside the check pass instead of at load, where the file is named
			expect(result.success).toBe(false);
		}
	});

	test('rejects a check module with no run export at all', () => {
		const { checkModule } = setupModule({ omit: 'run' });

		const result = StandardsCheckModule.safeParse(checkModule);

		// a check file that declares a kind but ships no function is a half-written
		// rule, not a judgment-only one
		expect(result.success).toBe(false);
	});

	test('rejects a module that exports the run function in place of the check object', () => {
		const result = StandardsCheckModule.safeParse(() => []);

		// the `check` export is the object pairing a kind with a function; a bare
		// function names no input
		expect(result.success).toBe(false);
	});

	test('keys the contract does not declare are stripped from the check module', () => {
		const { checkModule, run } = setupModule({ extra: { severity: 'blocking', settings: { maxLines: 40 } } });

		const parsed = StandardsCheckModule.parse(checkModule);

		// severity and settings come from the rule's front matter, never from the
		// check file — anything extra a package ships is dropped rather than
		// silently honored
		expect(parsed).toStrictEqual({ inputKind: 'file-list', run });
	});
});
