import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@lightsout/contracts';
import { isTestFile } from '../common/utils/isTestFile';

const exportPattern = /^export\s+(?:async\s+)?(?:const|class|function|interface|type|enum)\s+([A-Za-z0-9_$]+)/;

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
export const scanDeadExports = async ({ cwd, files, referenceFiles }: Params) => {
	const findings: ScanFinding[] = [];
	const contents = new Map<string, string>();

	for (const file of new Set([...files, ...(referenceFiles ?? [])])) {
		contents.set(file, (await readFile(join(cwd, file), 'utf8').catch(() => '')) ?? '');
	}

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

			if (basename(other).startsWith('index.')) {
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

		const cluster = `dead:${file}`;
		const base = { detector: ScanDetector.DeadExport, severity: ScanSeverity.Advisory, cluster, files: [{ path: file }] };

		if (!referencedBy.barrel && !referencedBy.test) {
			findings.push({ ...base, detail: `'${name}' is referenced nowhere else — dead code candidate (delete; version control has history)` });
		} else if (!referencedBy.source && referencedBy.test && !referencedBy.barrel) {
			findings.push({ ...base, detail: `'${name}' is referenced only by tests — production-dead candidate` });
		} else if (!referencedBy.source && referencedBy.barrel && !referencedBy.test) {
			findings.push({ ...base, detail: `'${name}' is exported through a barrel but no module consumes it — deliberate public API, or dead?` });
		}
	}

	return findings;
};
