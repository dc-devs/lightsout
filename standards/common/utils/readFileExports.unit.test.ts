import { expect, describe, test } from '@jest/globals';
import { readFileExports } from './readFileExports.ts';

describe('readFileExports', () => {
	test('reads every exported declaration in the order the file declares them', () => {
		const text = ['export interface Config {', '\tname: string;', '}', '', "export const defaultConfig: Config = { name: 'default' };"].join('\n');

		const exports = readFileExports({ text });

		expect(exports).toStrictEqual([
			{ keyword: 'interface', name: 'Config', line: 'export interface Config {' },
			{ keyword: 'const', name: 'defaultConfig', line: "export const defaultConfig: Config = { name: 'default' };" },
		]);
	});

	test.each([
		{ keyword: 'const', text: 'export const maxRetries = 10;', name: 'maxRetries' },
		{ keyword: 'class', text: 'export class HttpClient {', name: 'HttpClient' },
		{ keyword: 'function', text: 'export function getLabel() {', name: 'getLabel' },
		{ keyword: 'interface', text: 'export interface Params {', name: 'Params' },
		{ keyword: 'type', text: "export type Action = 'add';", name: 'Action' },
		{ keyword: 'enum', text: 'export enum Level {', name: 'Level' },
	])('reads an exported $keyword', ({ keyword, text, name }) => {
		const exports = readFileExports({ text });

		expect(exports).toStrictEqual([{ keyword, name, line: text }]);
	});

	test('reads an exported async function, whose keyword sits between export and function', () => {
		const exports = readFileExports({ text: 'export async function loadPage() {' });

		expect(exports).toStrictEqual([{ keyword: 'function', name: 'loadPage', line: 'export async function loadPage() {' }]);
	});

	test('ignores a declaration with no export keyword — the file is its only consumer', () => {
		const exports = readFileExports({ text: 'const sumTotals = () => 1;' });

		expect(exports).toStrictEqual([]);
	});

	test('ignores an interpolated name, which is a generator emitting code rather than a declaration', () => {
		const exports = readFileExports({ text: 'export const ${exportName} = 1;' });

		expect(exports).toStrictEqual([]);
	});

	test('reads a declaration whose value interpolates, since only an interpolated name marks generated code', () => {
		const text = 'export const getChargeLabel = ({ amount }: { amount: number }): string => `${amount}`;';

		const exports = readFileExports({ text });

		expect(exports).toStrictEqual([{ keyword: 'const', name: 'getChargeLabel', line: text }]);
	});

	test('ignores a re-export, which declares nothing of its own', () => {
		const exports = readFileExports({ text: "export { getLabel } from '@/labels/getLabel';" });

		expect(exports).toStrictEqual([]);
	});
});
