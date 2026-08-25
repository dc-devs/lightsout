import { describe, expect, test } from '@jest/globals';
import { StandardsFrameworksModule } from '#src/index.ts';

describe('StandardsFrameworksModule', () => {
	test('a frameworks module parses with the function the pack shipped', () => {
		const getFrameworkFacts = () => ({ isFrameworkLoadedFile: () => false });

		const parsed = StandardsFrameworksModule.parse({ getFrameworkFacts });

		// the engine calls this itself, so the parsed value must be the very
		// function the pack exported — not a copy or a wrapper
		expect(parsed).toStrictEqual({ getFrameworkFacts });
	});

	// a non-function would throw deep inside a run instead of at load, where the
	// pack is still named
	test.each([
		{ shape: 'the facts object the function was meant to return', getFrameworkFacts: { isFrameworkLoadedFile: () => false } as unknown },
		{ shape: 'the export name as a string', getFrameworkFacts: 'getFrameworkFacts' as unknown },
		{ shape: 'a number', getFrameworkFacts: 42 as unknown },
		{ shape: 'null', getFrameworkFacts: null as unknown },
		{ shape: 'an array', getFrameworkFacts: [] as unknown },
		{ shape: 'undefined', getFrameworkFacts: undefined as unknown },
	])('rejects a module whose export is $shape rather than callable', ({ getFrameworkFacts }) => {
		const result = StandardsFrameworksModule.safeParse({ getFrameworkFacts });

		expect(result.success).toBe(false);
	});

	test('rejects a module with no getFrameworkFacts export at all', () => {
		const result = StandardsFrameworksModule.safeParse({});

		// a pack that ships the file and forgets the export is half-written, not a
		// pack declining to answer — declining is shipping no file
		expect(result.success).toBe(false);
	});

	test('rejects a module that is the getFrameworkFacts function in place of the module object', () => {
		const result = StandardsFrameworksModule.safeParse(() => ({ isFrameworkLoadedFile: () => false }));

		// the engine imports a namespace and reads a named export off it — a pack
		// shipping the function as the module itself has no `getFrameworkFacts` to
		// read, and the load boundary says so while the pack is still named
		expect(result.success).toBe(false);
	});

	test('keys the contract does not declare are stripped', () => {
		const getFrameworkFacts = () => ({ isFrameworkLoadedFile: () => false });

		const parsed = StandardsFrameworksModule.parse({ getFrameworkFacts, carveOutSignals: { react: {} } });

		// the pack's own table stays inside the pack — anything extra it ships
		// through this module is dropped rather than silently honored
		expect(parsed).toStrictEqual({ getFrameworkFacts });
	});
});
