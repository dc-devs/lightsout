/**
 * Where a Decision-Log row came from in the planning dialogue. **Capitalized
 * on purpose** — a deliberate exception to the lowercase enum convention
 * (`TraverseEdgeKind`) so the JSON `source` field in `decisions.json` and the
 * markdown Decision-Log `Source` column share one token. The session writes
 * exactly these strings; `readDecisions` parses against them.
 */
export const DecisionSource = {
	Elicitation: 'Elicitation',
	Grill: 'Grill',
	Dedup: 'Dedup',
	Converge: 'Converge',
} as const;

export type DecisionSource = (typeof DecisionSource)[keyof typeof DecisionSource];
