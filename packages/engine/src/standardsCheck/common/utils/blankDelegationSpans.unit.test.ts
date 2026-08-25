import { describe, expect, test } from '@jest/globals';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { blankDelegationSpans } from '#src/standardsCheck/common/utils/blankDelegationSpans.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';

const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

const delegatingClass = [
	'export class RefactorRun {',
	'\tprivate readonly runState: RunState;',
	'',
	'\tconstructor({ runState }: { runState: RunState }) {',
	'\t\tthis.runState = runState;',
	'\t}',
	'',
	'\tupdate({ patch }: { patch: Partial<RunManifest> }): Promise<void> {',
	'\t\treturn this.runState.update({ patch });',
	'\t}',
	'',
	'\tsummarize(): string {',
	'\t\tconst summary = this.runState.read();',
	'',
	'\t\treturn `run: ${summary}`;',
	'\t}',
	'}',
].join('\n');

describe('blankDelegationSpans', () => {
	test('blanks the assigning constructor and the one-line forward, keeping every newline', () => {
		expectDefined(compiler);

		const blanked = blankDelegationSpans({ path: 'src/RefactorRun.ts', text: delegatingClass, compiler });

		const lines = blanked.split('\n');

		expect(lines).toHaveLength(delegatingClass.split('\n').length);
		expect(blanked).not.toContain('this.runState = runState');
		expect(blanked).not.toContain('return this.runState.update');
	});

	test('keeps a method that does more than forward', () => {
		expectDefined(compiler);

		const blanked = blankDelegationSpans({ path: 'src/RefactorRun.ts', text: delegatingClass, compiler });

		expect(blanked).toContain('const summary = this.runState.read();');
	});

	test('leaves a file with no classes untouched', () => {
		expectDefined(compiler);
		const text = 'export const totalCharges = ({ fees }: { fees: number[] }) => fees.reduce((sum, fee) => sum + fee, 0);\n';

		expect(blankDelegationSpans({ path: 'src/totalCharges.ts', text, compiler })).toBe(text);
	});
});
