import { describe, expect, test } from '@jest/globals';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupFileListInput } from '#src/index.ts';

describe('setupFileListInput', () => {
	test('builds the arm a file-list check narrows to', () => {
		expect(setupFileListInput().kind).toBe(StandardsInputKind.FileList);
	});

	test('called bare, every field defaults to the empty shape a check can read', () => {
		const input = setupFileListInput();

		expect(input).toStrictEqual({
			kind: StandardsInputKind.FileList,
			cwd: '/repo',
			source: [],
			tests: [],
			files: [],
			referenceFiles: [],
			dependencies: new Map(),
			standardsPacks: [],
		});
	});

	test('given files, takes them as the source too', () => {
		const input = setupFileListInput({ files: ['src/app.ts'] });

		// the reading most rules want: a repo's files ARE its source files unless
		// the test says otherwise
		expect(input).toMatchObject({ files: ['src/app.ts'], source: ['src/app.ts'], tests: [] });
	});

	test('given source and tests instead, files becomes both together', () => {
		const input = setupFileListInput({ source: ['src/app.ts'], tests: ['src/app.unit.test.ts'] });

		expect(input).toMatchObject({
			source: ['src/app.ts'],
			tests: ['src/app.unit.test.ts'],
			files: ['src/app.ts', 'src/app.unit.test.ts'],
		});
	});

	test('an explicit files list wins over the one that would be derived', () => {
		const input = setupFileListInput({ source: ['src/app.ts'], tests: ['src/app.unit.test.ts'], files: ['src/only.ts'] });

		expect(input).toMatchObject({ files: ['src/only.ts'] });
	});

	test('dependency pairs become the map the contract declares', () => {
		const input = setupFileListInput({ dependencies: [['.', ['zod']]] });

		expect(input).toMatchObject({ dependencies: new Map([['.', ['zod']]]) });
	});

	test('any field can be overridden outright', () => {
		expect(setupFileListInput({ cwd: '/elsewhere', standardsPacks: ['vendor/acme'] })).toMatchObject({
			cwd: '/elsewhere',
			standardsPacks: ['vendor/acme'],
		});
	});
});
