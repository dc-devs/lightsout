import { describe, expect, test } from '@jest/globals';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupFileTextInput } from './index.ts';

describe('setupFileTextInput', () => {
	test('builds the arm a file-text check narrows to', () => {
		expect(setupFileTextInput().kind).toBe(StandardsInputKind.FileText);
	});

	test('the pairs become the contents map, and their paths become the file lists', () => {
		const input = setupFileTextInput({ contents: [['src/app.ts', 'export const a = 1;']] });

		// saying what a file contains has already said the file exists — repeating
		// the list is how the hand-rolled copies of this drifted apart
		expect(input).toMatchObject({
			contents: new Map([['src/app.ts', 'export const a = 1;']]),
			files: ['src/app.ts'],
			source: ['src/app.ts'],
		});
	});

	test('a file listed but deliberately unreadable is stated by overriding files', () => {
		const input = setupFileTextInput({ contents: [['src/app.ts', '']], files: ['src/app.ts', 'src/missing.ts'] });

		// the case a rule about unreadable files needs: known to the run, absent
		// from the cache
		expect(input).toMatchObject({ files: ['src/app.ts', 'src/missing.ts'] });
		expect((input as { contents: Map<string, string> }).contents.has('src/missing.ts')).toBe(false);
	});

	test('with nothing passed, every list is empty rather than invented', () => {
		expect(setupFileTextInput()).toMatchObject({ files: [], source: [], tests: [], contents: new Map() });
	});
});
