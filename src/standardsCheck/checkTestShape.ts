import { StandardsRule, type StandardsFinding } from '@/contracts';
import type { StandardsPass } from '@/standardsCheck/common/types/StandardsPass';
import { checkTestMockRules } from '@/standardsCheck/common/utils/checkTestMockRules';
import { checkTestStructureRules } from '@/standardsCheck/common/utils/checkTestStructureRules';
import { getRuleSettings } from '@/standardsCheck/common/utils/getRuleSettings';
import { readFileContents } from '@/standardsCheck/common/utils/readFileContents';

/**
 * Test-file shape against standards/tests/unit/jest/unit-testing.md: how mocks
 * are declared and typed, where return values and assertions may live, how
 * describe blocks nest, and how far a setup factory may sprawl.
 *
 * Text-level throughout, so it survives on JS-only repos. It reads the `tests`
 * list rather than `source` — the only pass that does.
 *
 * The document's precedence section (legacy tests are not renovated by a
 * feature task) is answered structurally, not by weakening a rule: the pipeline
 * gate only inspects files a run changed, and a repo carrying a large legacy
 * suite sets these rules to `advisory` or `off` in one committed config line.
 */
export const checkTestShape: StandardsPass = async ({ cwd, tests, states }) => {
	const contents = await readFileContents({ cwd, files: tests });
	const settings = getRuleSettings({ states, rule: StandardsRule.TestMegaFactory });
	const findings: StandardsFinding[] = [];

	for (const [file, text] of contents) {
		findings.push(...checkTestMockRules({ file, text }), ...checkTestStructureRules({ file, text, settings }));
	}

	return findings;
};
