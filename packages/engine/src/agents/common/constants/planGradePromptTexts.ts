import planDocsCheckPrompt from '#src/agents/prompts/planDocsCheck.md';
import planFindingRecheckPrompt from '#src/agents/prompts/planFindingRecheck.md';
import planGapCheckPrompt from '#src/agents/prompts/planGapCheck.md';
import planGapCheckDecisionsPrompt from '#src/agents/prompts/planGapCheckDecisions.md';
import planGapCheckSurfacePrompt from '#src/agents/prompts/planGapCheckSurface.md';
import planGapCheckWiringPrompt from '#src/agents/prompts/planGapCheckWiring.md';
import planGapJudgePrompt from '#src/agents/prompts/planGapJudge.md';

/**
 * Every brief that shapes a plan-grading pass, in a fixed order: the shared
 * reader brief, its three lens briefs, the judge brief, the documentation brief
 * and the re-verification brief. A lens brief changes what a reader looks for as
 * much as the shared brief does, so all seven are in.
 *
 * The grade fingerprint hashes these to decide whether a recorded review still
 * speaks for the current pass. The list lives here, beside the briefs, because a
 * brief renamed or split is this module's own change — a fingerprint assembled
 * elsewhere would silently drop it and go on calling a stale review current.
 */
export const planGradePromptTexts = [
	planGapCheckPrompt,
	planGapCheckSurfacePrompt,
	planGapCheckWiringPrompt,
	planGapCheckDecisionsPrompt,
	planGapJudgePrompt,
	planDocsCheckPrompt,
	planFindingRecheckPrompt,
];
