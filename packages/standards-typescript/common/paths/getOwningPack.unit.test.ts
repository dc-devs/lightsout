import { describe, expect, test } from '@jest/globals';
import { getOwningPack } from './getOwningPack.ts';

describe('getOwningPack', () => {
	test('names the standards pack a file sits inside', () => {
		expect(getOwningPack({ path: 'standards/common/utils/isTestFile.ts', standardsPacks: ['standards'] })).toBe('standards');
	});

	test('names the repo itself for a file in no pack', () => {
		expect(getOwningPack({ path: 'src/common/utils/isTestFile.ts', standardsPacks: ['standards'] })).toBe('.');
	});

	test('everything belongs to the repo when it holds no pack at all', () => {
		expect(getOwningPack({ path: 'src/app.ts', standardsPacks: [] })).toBe('.');
	});

	test('tells two packs apart, so one pack never shares a boundary with another', () => {
		const standardsPacks = ['standards', 'vendor/acme-standards'];

		expect(getOwningPack({ path: 'standards/code/x/check.ts', standardsPacks })).toBe('standards');
		expect(getOwningPack({ path: 'vendor/acme-standards/code/x/check.ts', standardsPacks })).toBe('vendor/acme-standards');
	});

	test('a nested pack wins over the one containing it, since it is the nearer boundary', () => {
		const standardsPacks = ['standards', 'standards/vendored'];

		expect(getOwningPack({ path: 'standards/vendored/code/x/check.ts', standardsPacks })).toBe('standards/vendored');
	});

	test('a root covers only paths beneath it, never one that merely starts with its name', () => {
		expect(getOwningPack({ path: 'standards-archive/code/x/check.ts', standardsPacks: ['standards'] })).toBe('.');
	});
});
