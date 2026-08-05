import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Detector, MemoryStore } from '@jscpd/core';
import { Tokenizer } from '@jscpd/tokenizer';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@/contracts';
import { blankImportSpans } from '@/scan/blankImportSpans';

const defaultMinTokens = 50;
const formatOf = (path: string) => (/\.(m|c)?tsx?$/.test(path) ? 'typescript' : 'javascript');

interface Params {
	cwd: string;
	/** Repo-relative non-test source files (test literals are contract-pinning, never clones). */
	files: string[];
	/** Per-repo clone floor (config `scan.minCloneTokens`, default 50). */
	minTokens?: number;
}

/**
 * Tier 1 of the duplication ladder: jscpd token-span clone detection —
 * catches copy-paste and renamed functions with identical bodies, including
 * sub-function spans the AST tier can't see. Misses systematic identifier
 * renames (that's tier 2's job).
 */
export const scanClones = async ({ cwd, files, minTokens = defaultMinTokens }: Params) => {
	const detector = new Detector(new Tokenizer(), new MemoryStore(), [], { minTokens, minLines: 5 });
	const findings: ScanFinding[] = [];

	for (const file of files) {
		const text = await readFile(join(cwd, file), 'utf8').catch(() => undefined);

		if (text === undefined) {
			continue;
		}

		// Imports are non-deduplicable by construction — blank them (newline-
		// preserving) so shared import lists never token-match as clones.
		const clones = await detector.detect(file, blankImportSpans({ text }), formatOf(file));

		for (const clone of clones) {
			const a = clone.duplicationA;
			const b = clone.duplicationB;

			findings.push({
				detector: ScanDetector.Clone,
				severity: ScanSeverity.Finding,
				cluster: `clone:${b.sourceId}:${b.start.line}`,
				files: [
					{ path: b.sourceId, startLine: b.start.line, endLine: b.end.line },
					{ path: a.sourceId, startLine: a.start.line, endLine: a.end.line },
				],
				detail: `${a.end.line - a.start.line + 1}-line duplicated span`,
			});
		}
	}

	return findings;
};
