import { describe, expect, test } from '@jest/globals';
import { readDocumentTitle } from '#src/features/packs/common/utils/readDocumentTitle.ts';

describe('readDocumentTitle', () => {
	test('takes the title from the intro’s top heading', () => {
		expect(readDocumentTitle({ intro: '# Folder Structure\n\nWhere things live.', path: 'code/architecture/folder-structure' })).toBe('Folder Structure');
	});

	test('falls back to the folder name, made readable, when the intro has no heading', () => {
		expect(readDocumentTitle({ intro: 'No heading here.', path: 'code/style-guide/return-types' })).toBe('Return types');
	});
});
