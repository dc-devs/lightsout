import { describe, expect, test } from '@jest/globals';
import { getOwningPackage } from './getOwningPackage.ts';

describe('getOwningPackage', () => {
	test('names the standards package a file sits inside', () => {
		expect(getOwningPackage({ path: 'standards/common/utils/isTestFile.ts', standardsPackages: ['standards'] })).toBe('standards');
	});

	test('names the repo itself for a file in no package', () => {
		expect(getOwningPackage({ path: 'src/common/utils/isTestFile.ts', standardsPackages: ['standards'] })).toBe('.');
	});

	test('everything belongs to the repo when it holds no package at all', () => {
		expect(getOwningPackage({ path: 'src/app.ts', standardsPackages: [] })).toBe('.');
	});

	test('tells two packages apart, so one package never shares a boundary with another', () => {
		const standardsPackages = ['standards', 'vendor/acme-standards'];

		expect(getOwningPackage({ path: 'standards/code/x/check.ts', standardsPackages })).toBe('standards');
		expect(getOwningPackage({ path: 'vendor/acme-standards/code/x/check.ts', standardsPackages })).toBe('vendor/acme-standards');
	});

	test('a nested package wins over the one containing it, since it is the nearer boundary', () => {
		const standardsPackages = ['standards', 'standards/vendored'];

		expect(getOwningPackage({ path: 'standards/vendored/code/x/check.ts', standardsPackages })).toBe('standards/vendored');
	});

	test('a root covers only paths beneath it, never one that merely starts with its name', () => {
		expect(getOwningPackage({ path: 'standards-archive/code/x/check.ts', standardsPackages: ['standards'] })).toBe('.');
	});
});
