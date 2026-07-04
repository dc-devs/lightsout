import { z } from 'zod';
import { TraverseEdgeKind } from './TraverseEdgeKind';

/**
 * One traverse-hop agent's structured report: one node, one entry anchor,
 * one data-of-interest → entry, transforms, and every process-boundary exit.
 * JSON (not the prototype's YAML — supersedes T12's format, keeps its
 * substance: data not prose, validated at the boundary, cheap re-emit on
 * mismatch). Enum-ish fields degrade instead of sinking the report: a novel
 * exit kind becomes 'other' (routing then records a gap, which is safe);
 * unknown relevance stays 'unsure'.
 */
export const HopReport = z.object({
	node: z.string(),
	anchorCheck: z.object({
		status: z.enum(['ok', 'drifted', 'missing']),
		/** file:line where the anchor actually was, when drifted. */
		foundAt: z.string().nullable().default(null),
	}),
	/** One line — where the data enters, file:line. */
	entry: z.string(),
	transforms: z
		.array(
			z.object({
				at: z.string(),
				what: z.string(),
			}),
		)
		.default([]),
	exits: z
		.array(
			z.object({
				kind: z.enum(TraverseEdgeKind).catch(TraverseEdgeKind.Other),
				/** URL pattern / stream name / channel. */
				target: z.string(),
				at: z.string(),
				/** What of the data-of-interest this payload carries. */
				carries: z.string(),
				/** Gating condition, when any. */
				conditional: z.string().nullable().default(null),
				relevant: z.enum(['yes', 'no', 'unsure']).catch('unsure'),
			}),
		)
		.default([]),
	/** 1–3 sentences — what this hop establishes toward the question. */
	answerContribution: z.string(),
	/** Anything the agent could not determine, and why. */
	gaps: z.array(z.string()).default([]),
	confidence: z.enum(['solid', 'partial', 'dead-end']).catch('partial'),
});

export type HopReport = z.infer<typeof HopReport>;
