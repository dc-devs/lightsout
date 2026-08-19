import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildTestLimitCheck } from '../../../common/utils/buildTestLimitCheck.ts';

export const check: StandardsCheckModule = buildTestLimitCheck({
	rule: 'test-size-file',
	setting: 'testFile',
	report: ({ file, text, limit }) => {
		const lineCount = text.split('\n').length;

		return lineCount <= limit ? undefined : { files: [{ path: file }], detail: `${lineCount} lines (cap ~${limit})` };
	},
	guidance:
		'A test file this long is a module asking for promotion — give each internal unit a direct test beside it, export the unit from the module’s barrel, and leave the boundary file its orchestration.',
});
