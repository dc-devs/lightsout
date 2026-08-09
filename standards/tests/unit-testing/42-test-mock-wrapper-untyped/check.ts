import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import type { CallBlock } from '../../../common/types/CallBlock.ts';
import { buildLineSites } from '../../../common/utils/buildLineSites.ts';
import { buildRawFinding } from '../../../common/utils/buildRawFinding.ts';
import { readCallBlocks } from '../../../common/utils/readCallBlocks.ts';
import { readTestFiles } from '../../../common/utils/readTestFiles.ts';

/** The legacy wrapper the prose names outright: a factory forward typed to discard its arguments. */
const discardingWrapper = /\(\s*\.\.\.\s*[A-Za-z0-9_$]+\s*:\s*unknown\s*\[\s*\]/;

/** `<property>: () => mockThing()` — a forward that takes no arguments at all. */
const zeroArgWrapper = /([A-Za-z0-9_$]+)\s*:\s*\(\s*\)\s*=>\s*(mock[A-Za-z0-9_$]*)\s*\(/g;

// A discarding wrapper is legacy debt the prose names outright. A zero-argument
// forward needs evidence — the file's own `toHaveBeenCalledWith` on that mock
// proves the function takes arguments, and without it there is no violation to
// report.
const wrapperFindings = ({ file, text }: { file: string; text: string }) => {
	const wrappers: Array<{ block: CallBlock; reasons: string[] }> = [];

	for (const block of readCallBlocks({ text, callees: ['jest.mock'] })) {
		const reasons: string[] = discardingWrapper.test(block.body) ? ['a `(...args: unknown[])` wrapper'] : [];

		for (const forward of block.body.matchAll(zeroArgWrapper)) {
			if (new RegExp(`expect\\(\\s*${forward[2]}\\s*\\)[^;]*toHaveBeenCalledWith`).test(text)) {
				reasons.push(`'${forward[1]}' forwards no arguments to ${forward[2]}`);
			}
		}

		if (reasons.length > 0) {
			wrappers.push({ block, reasons });
		}
	}

	return wrappers.length === 0
		? []
		: [
				buildRawFinding({
					rule: 'test-mock-wrapper-untyped',
					files: buildLineSites({ file, spans: wrappers.map(({ block }) => block) }),
					detail: wrappers.map(({ block, reasons }) => `${reasons.join('; ')} (line ${block.startLine})`).join(', '),
					guidance: 'Type the factory wrapper to the real parameters — a discarded argument makes `toHaveBeenCalledWith` fail on a call that was correct.',
				}),
			];
};

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	run: ({ input }): RawStandardsFinding[] => readTestFiles({ input }).flatMap(wrapperFindings),
};
