import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../common/utils/buildRawFinding.ts';
import { readTestFiles } from '../../../common/utils/readTestFiles.ts';

const buildFileFindings = ({ file, text, cap }: { file: string; text: string; cap: number }) => {
	const lineCount = text.split('\n').length;

	return lineCount <= cap
		? []
		: [
				buildRawFinding({
					rule: 'test-size-file',
					files: [{ path: file }],
					detail: `${lineCount} lines (cap ~${cap})`,
					guidance:
						'A test file this long is a module asking for promotion — give each internal unit a direct test beside it, export the unit from the module’s barrel, and leave the boundary file its orchestration.',
				}),
			];
};

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	run: ({ input, settings }): RawStandardsFinding[] =>
		readTestFiles({ input }).flatMap(({ file, text }) => buildFileFindings({ file, text, cap: settings.testFile })),
};
