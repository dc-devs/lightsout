import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildLineSites } from '../../../common/utils/buildLineSites.ts';
import { buildRawFinding } from '../../../common/utils/buildRawFinding.ts';
import { readCallBlocks } from '../../../common/utils/readCallBlocks.ts';
import { readTestFiles } from '../../../common/utils/readTestFiles.ts';
import { scanTestLines } from '../../../common/utils/scanTestLines.ts';

/** A `let` declaration, however it is indented — the enclosing blocks decide whether it is shared state. */
const letDeclaration = /^\s*let\s+([A-Za-z0-9_$]+)/;

// A `let` inside a hook or a test body is that block's own local; only one
// declared at module or describe scope can be the mutable subject the rule
// bans, and only when a `beforeEach` reassigns it.
const sharedLetFindings = ({ file, text }: { file: string; text: string }) => {
	const blocks = readCallBlocks({ text, callees: ['beforeEach', 'beforeAll', 'afterEach', 'afterAll', 'test', 'it'] });
	const beforeEachBlocks = blocks.filter((block) => block.callee === 'beforeEach');
	const shared = scanTestLines({ text, pattern: letDeclaration }).filter(
		({ name, line }) =>
			!blocks.some((block) => block.startLine <= line && line <= block.endLine) &&
			beforeEachBlocks.some((block) => new RegExp(`\\b${name}\\s*=(?![=>])`).test(block.body)),
	);

	return shared.length === 0
		? []
		: [
				buildRawFinding({
					rule: 'test-shared-let',
					files: buildLineSites({ file, spans: shared.map(({ line }) => ({ startLine: line, endLine: line })) }),
					detail: `${shared.map(({ name, line }) => `'${name}' (line ${line})`).join(', ')} reassigned in a beforeEach`,
					guidance: 'Arrange in a `setup()` factory that returns its locals as consts, so no test depends on what another left behind.',
				}),
			];
};

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	run: ({ input }): RawStandardsFinding[] => readTestFiles({ input }).flatMap(sharedLetFindings),
};
