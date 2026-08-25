import { Detector, MemoryStore } from '@jscpd/core';
import { Tokenizer } from '@jscpd/tokenizer';
import type ts from 'typescript';
import { type CloneSpan, type CloneSpansInput, StandardsInputKind } from '#src/contracts/index.ts';
import { readIntoCache } from '#src/standardsCheck/common/checkInputs/readIntoCache.ts';
import { blankDelegationSpans } from '#src/standardsCheck/common/utils/blankDelegationSpans.ts';
import { blankImportSpans } from '#src/standardsCheck/common/utils/blankImportSpans.ts';

interface Params {
	cwd: string;
	source: string[];
	/** The duplicate-code-block rule's own resolved settings — the engine honors them because it runs the detector. */
	settings: Record<string, number>;
	cache: Map<string, string>;
	/** The consumer's TypeScript, when the install has one — without it the delegation-forward blanking is skipped, never guessed. */
	compiler?: typeof ts;
}

const formatOf = ({ path }: { path: string }) => (/\.(m|c)?tsx?$/.test(path) ? 'typescript' : 'javascript');

/**
 * Duplicated spans, from the same jscpd detector the check has
 * always used. The engine runs it rather than the rule, so the rule's
 * `minTokens` reaches the detector as a setting instead of a rule opening files
 * of its own — which is also why a second duplicate-block rule with a different threshold
 * would simply get its own detection run.
 *
 * Imports are blanked first (newline-preserving): a shared import list is
 * non-deduplicable by construction, so counting it as duplication would report
 * work nobody can do, and blanking keeps the reported line numbers true. The
 * composition remedy's delegation forwards are blanked the same way and for
 * the same reason — the standards mandate that shape, so it is never work
 * (see `blankDelegationSpans`).
 *
 * @param settings - the rule's resolved numbers; `minTokens` drives the detector
 */
export const buildCloneSpansInput = async ({ cwd, source, settings, cache, compiler }: Params): Promise<CloneSpansInput> => {
	const { minTokens } = settings;

	const texts = await readIntoCache({ cwd, paths: source, cache });
	const detector = new Detector(new Tokenizer(), new MemoryStore(), [], { minTokens, minLines: 5 });
	const spans: CloneSpan[] = [];

	for (const [path, text] of texts) {
		const blanked = blankImportSpans({ text });
		const detectable = compiler === undefined ? blanked : blankDelegationSpans({ path, text: blanked, compiler });

		for (const clone of await detector.detect(path, detectable, formatOf({ path }))) {
			const a = clone.duplicationA;
			const b = clone.duplicationB;

			spans.push({
				files: [
					{ path: b.sourceId, startLine: b.start.line, endLine: b.end.line },
					{ path: a.sourceId, startLine: a.start.line, endLine: a.end.line },
				],
				// jscpd's own measure of a clone's size: the distance between the
				// first and last token of the span. Both ends are optional in its
				// types, and a span it could not place counts as no tokens.
				tokens: (a.end.position ?? 0) - (a.start.position ?? 0),
			});
		}
	}

	return { kind: StandardsInputKind.CloneSpans, cwd, source, spans };
};
