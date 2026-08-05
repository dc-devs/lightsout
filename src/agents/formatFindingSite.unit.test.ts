import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ScanFinding } from '@/contracts';
import { formatFindingSite } from '@/agents';

interface SetupParams {
	/** Absent line numbers model a whole-file finding. */
	startLine?: number;
	endLine?: number;
}

const setupSite = ({ startLine, endLine }: SetupParams = {}) => {
	const file: ScanFinding['files'][number] = { path: 'src/widget/widget.ts', startLine, endLine };

	return { file };
};

describe('formatFindingSite', () => {
	test('renders the bare path when the finding carries no line numbers', () => {
		const { file } = setupSite();

		const site = formatFindingSite({ file });

		assert.equal(site, 'src/widget/widget.ts');
	});

	test('appends the start line when the finding names a single line', () => {
		const { file } = setupSite({ startLine: 12 });

		const site = formatFindingSite({ file });

		assert.equal(site, 'src/widget/widget.ts:12');
	});

	test('renders a span when the finding covers a range of lines', () => {
		const { file } = setupSite({ startLine: 12, endLine: 40 });

		const site = formatFindingSite({ file });

		assert.equal(site, 'src/widget/widget.ts:12-40');
	});

	test('collapses a one-line span to a single line number', () => {
		const { file } = setupSite({ startLine: 12, endLine: 12 });

		const site = formatFindingSite({ file });

		assert.equal(site, 'src/widget/widget.ts:12');
	});

	test('ignores an end line that arrives without a start line', () => {
		const { file } = setupSite({ endLine: 40 });

		const site = formatFindingSite({ file });

		assert.equal(site, 'src/widget/widget.ts');
	});
});
