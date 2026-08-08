import { basename } from 'node:path';
import { StandardsRule } from '@/contracts';
import { readFileContents } from '@/standardsCheck/common/utils/readFileContents';
import { isTestFile } from '@/common/utils/isTestFile';
import type { StandardsPass } from '@/standardsCheck/common/types/StandardsPass';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';
import { buildSiteKey } from '@/standardsCheck/common/utils/buildSiteKey';

const exportPattern = /^export\s+(?:async\s+)?(?:const|class|function|interface|type|enum)\s+([A-Za-z0-9_$]+)/;
// An index file is a BARREL only if it exports; an entry index that only
// imports-and-runs is an ordinary consumer (live false positive: every CLI
// command read as "exported through a barrel but no module consumes it"
// because the executable dispatcher index.ts was counted as a barrel).
const isBarrel = ({ file, text }: { file: string; text: string }) => basename(file).startsWith('index.') && /^export\b/m.test(text);

/**
 * The three mutually exclusive verdicts an unconsumed export lands in, tested
 * in order. Three rules rather than one, so a repo can switch off the
 * barrel-only one — a deliberate public API is not a defect — while keeping the
 * other two. An export reached from BOTH a barrel and a test matches none of
 * them and is never reported.
 */
const verdicts = [
	{
		rule: StandardsRule.DeadExport,
		matches: ({ barrel, test }: { barrel: boolean; test: boolean }) => !barrel && !test,
		detail: 'referenced nowhere else',
		guidance: 'A dead code candidate. Delete it — version control has the history.',
	},
	{
		rule: StandardsRule.TestOnlyExport,
		matches: ({ barrel, test }: { barrel: boolean; test: boolean }) => test && !barrel,
		detail: 'referenced only by tests',
		guidance: 'A production-dead candidate: only its own tests keep it alive.',
	},
	{
		rule: StandardsRule.BarrelOnlyExport,
		matches: ({ barrel, test }: { barrel: boolean; test: boolean }) => barrel && !test,
		detail: 'exported through a barrel but no module consumes it',
		guidance: 'Deliberate public API, or dead? Only the author knows.',
	},
];

/**
 * Dead-export detection by whole-word reference counting — viable because
 * one-export-per-file makes every export a distinct searchable name (a knip
 * replacement: bundling knip into the committed CLI is impractical, and
 * name-counting under this repo convention is honest enough for advisory
 * findings). Conservative by construction: a name mentioned in a comment or
 * string still counts as a reference, so false "dead" calls are rare. Every
 * export of one file landing in the same verdict is ONE finding, naming each.
 */
export const checkDeadExports: StandardsPass = async ({ cwd, files, referenceFiles }) => {
	const contents = await readFileContents({ cwd, files: [...files, ...referenceFiles] });

	const scope = new Set(files);
	const declarations: Array<{ name: string; file: string }> = [];

	for (const [file, text] of contents) {
		if (!scope.has(file) || basename(file).startsWith('index.') || isTestFile(file)) {
			continue;
		}

		for (const line of text.split('\n')) {
			const match = line.match(exportPattern);

			if (match?.[1] && match[1].length >= 4) {
				declarations.push({ name: match[1], file });
			}
		}
	}

	const grouped = new Map<string, { rule: StandardsRule; file: string; names: string[]; detail: string; guidance: string }>();

	for (const { name, file } of declarations) {
		const pattern = new RegExp(`\\b${name}\\b`);
		const referencedBy = { barrel: false, test: false, source: false };

		for (const [other, text] of contents) {
			if (other === file || !pattern.test(text)) {
				continue;
			}

			if (isBarrel({ file: other, text })) {
				referencedBy.barrel = true;
			} else if (isTestFile(other)) {
				referencedBy.test = true;
			} else {
				referencedBy.source = true;
			}
		}

		if (referencedBy.source) {
			continue;
		}

		const verdict = verdicts.find((entry) => entry.matches(referencedBy));

		if (verdict === undefined) {
			continue;
		}

		const siteKey = buildSiteKey({ rule: verdict.rule, files: [{ path: file }] });
		const group = grouped.get(siteKey) ?? { rule: verdict.rule, file, names: [], detail: verdict.detail, guidance: verdict.guidance };

		grouped.set(siteKey, { ...group, names: [...group.names, name] });
	}

	return [...grouped.values()].map(({ rule, file, names, detail, guidance }) =>
		buildFinding({
			rule,
			files: [{ path: file }],
			detail: `${names.map((name) => `'${name}'`).join(', ')} ${names.length > 1 ? 'are' : 'is'} ${detail}`,
			guidance,
		}),
	);
};
