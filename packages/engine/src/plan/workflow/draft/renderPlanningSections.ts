import { basename } from 'node:path';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { rewritePlanSection } from '#src/plan/sections/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { planningGeneratedSections } from '#src/plan/workflow/draft/common/utils/planningGeneratedSections.ts';

interface Params {
	snapshot: PlanningSnapshot;
	artifacts: ReadonlyMap<string, string>;
	/** Exact previous canonical semantics authorize replacing an older generated section after a change. */
	previous?: PlanningSnapshot;
}

/** Regenerate recognized engine-owned sections atomically in memory, refusing to discard unrepresented authored content. */
export const renderPlanningSections = ({ snapshot, artifacts, previous }: Params): Map<string, string> => {
	const generated = planningGeneratedSections({ snapshot, artifacts });
	const prior = previous ? planningGeneratedSections({ snapshot: previous, artifacts: previous.artifacts }) : new Map<string, Map<string, string>>();
	const result = new Map(artifacts);
	for (const [path, sections] of generated) {
		let content = artifacts.get(path);
		if (content === undefined) throw new Error(`Missing planning artifact for section rendering: ${path}`);
		const phaseId = snapshot.record.artifacts.find((artifact) => artifact.path === path)?.phaseId;
		const priorPath = phaseId ? (previous?.record.artifacts.find((artifact) => artifact.phaseId === phaseId)?.path ?? path) : path;
		const initial = parsePlan({ content, base: basename(path) });
		if ((initial.duplicateSections?.length ?? 0) > 0 || initial.unterminatedFence)
			throw new Error(
				`Planning artifact requires repair before regeneration: ${path}; duplicated headings or an unterminated code fence. Preserve this authored content:\n${content}`,
			);
		for (const [heading, section] of sections) {
			const parsed = parsePlan({ content, base: basename(path) });
			const range = parsed.sectionRanges.get(heading);
			if (range) {
				const carried = parsed.lines
					.slice(range.start - 1, range.end)
					.join('\n')
					.trim();
				const empty = parsed.sections.get(heading)?.every((line) => line.trim() === '') ?? true;
				if (!empty && carried !== section.trim() && carried !== prior.get(priorPath)?.get(heading)?.trim())
					throw new Error(
						`Planning section requires repair before regeneration: ${path} / ${heading}. Preserve or represent this authored content in the canonical claims before retrying:\n${carried}`,
					);
			}
			content = rewritePlanSection({ content, base: basename(path), heading, section });
		}
		result.set(path, content);
	}
	return result;
};
