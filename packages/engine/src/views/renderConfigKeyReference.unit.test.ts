import { describe, expect, test } from '@jest/globals';
import { configKeyDescriptions } from '#src/views/common/constants/configKeyDescriptions.ts';
import { renderConfigKeyReference } from '#src/views/renderConfigKeyReference.ts';

/** The table's body — every line after the header and its delimiter. */
const bodyLines = () => renderConfigKeyReference().split('\n').slice(2);

/** The key a row names, read back out of its first cell's backticks. */
const rowKey = ({ line }: { line: string }) => line.split(' | ')[0].replace('| `', '').replace('`', '');

/** One key's row, or undefined when nothing names it. */
const findRow = ({ key }: { key: string }) => bodyLines().find((line) => rowKey({ line }) === key);

describe('renderConfigKeyReference', () => {
	test('opens with the header and its delimiter, so the region is a table on its own', () => {
		const lines = renderConfigKeyReference().split('\n');

		expect(lines[0]).toBe('| Field | Required | What it controls |');
		expect(lines[1]).toBe('| --- | ---: | --- |');
		expect(lines.filter((line) => line === '| Field | Required | What it controls |')).toHaveLength(1);
	});

	test('right-aligns the Required column, as every other table on the page has it', () => {
		expect(renderConfigKeyReference().split('\n')[1].split(' | ')[1]).toBe('---:');
	});

	test('gives every described key exactly one row, which is what makes a new key appear in the document', () => {
		expect(bodyLines().map((line) => rowKey({ line }))).toStrictEqual(Object.keys(configKeyDescriptions));
	});

	test('names no key the constant does not describe, so the region can hold no row no code produces', () => {
		expect(bodyLines().filter((line) => configKeyDescriptions[rowKey({ line })] === undefined)).toStrictEqual([]);
	});

	test('reads the Required column off the schema — `gates` is the one key a config must write', () => {
		expect(findRow({ key: 'gates' })).toContain('| yes |');
		expect(findRow({ key: 'harness' })).toContain('| no |');
	});

	test('follows a dotted key into its block, which is how the two timeout leaves resolve at all', () => {
		expect(findRow({ key: 'timeouts.agent-minutes' })).toContain('| no |');
	});

	test('carries each key’s own sentence as the third cell, so the document and the page cannot disagree', () => {
		expect(findRow({ key: 'packages-dir' })).toBe(`| \`packages-dir\` | no | ${configKeyDescriptions['packages-dir']} |`);
	});
});
