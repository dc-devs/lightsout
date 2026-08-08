import { basename } from 'node:path';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { readFileContents } from '@/scan/common/utils/readFileContents';
import { isTestFile } from '@/common/utils/isTestFile';

const exportPattern = /^export\s+(?:async\s+)?(?:const|class|function|interface|type|enum)\s+([A-Za-z0-9_$]+)/;
// An index file is a BARREL only if it exports; an entry index that only
// imports-and-runs is an ordinary consumer (live false positive: every CLI
// command read as "exported through a barrel but no module consumes it"
// because the executable dispatcher index.ts was counted as a barrel).
const isBarrel = ({ file, text }: { file: string; text: string }) => basename(file).startsWith('index.') && /^export\b/m.test(text);

interface Params {
	cwd: string;
	/** Files whose exports are candidates (the scan scope) — tests and barrels included. */
	files: string[];
	/**
	 * Files searched for references — always the WHOLE repo, even when the
	 * scan scope is a subpath: a consumer outside the scope is still a
	 * consumer (live false positive: NestJS route modules "dead" because
	 * app.module.ts sat outside the scanned path).
	 */
	referenceFiles?: string[];
}

/**
 * Dead-export detection by whole-word reference counting — viable because
 * one-export-per-file makes every export a distinct searchable name (a knip
 * replacement: bundling knip into the committed CLI is impractical, and
 * name-counting under this repo convention is honest enough for advisory
 * findings). Conservative by construction: a name mentioned in a comment or
 * string still counts as a reference, so false "dead" calls are rare.
 * Barrel-only and test-only references get their own callouts.
 */
export const scanDeadExports = async ({ cwd, files, referenceFiles }: Params): Promise<StandardsFinding[]> => {
	const findings: StandardsFinding[] = [];
	const contents = await readFileContents({ cwd, files: [...files, ...(referenceFiles ?? [])] });

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

		const siteKey = `dead:${file}`;
		const base = { rule: StandardsRule.DeadExport, severity: StandardsSeverity.Advisory, siteKey, files: [{ path: file }] };

		if (!referencedBy.barrel && !referencedBy.test) {
			findings.push({ ...base, detail: `'${name}' is referenced nowhere else`, guidance: 'A dead code candidate. Delete it — version control has the history.' });
		} else if (!referencedBy.source && referencedBy.test && !referencedBy.barrel) {
			findings.push({ ...base, detail: `'${name}' is referenced only by tests`, guidance: 'A production-dead candidate: only its own tests keep it alive.' });
		} else if (!referencedBy.source && referencedBy.barrel && !referencedBy.test) {
			findings.push({ ...base, detail: `'${name}' is exported through a barrel but no module consumes it`, guidance: 'Deliberate public API, or dead? Only the author knows.' });
		}
	}

	return findings;
};
