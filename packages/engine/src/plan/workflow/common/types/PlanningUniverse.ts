/** Scoped deterministic IO inventory, not a semantic repository exploration. */
export interface PlanningUniverse {
	files: Array<{ path: string; sha256: string; content?: string }>;
	members: Array<{ path: string; kind: string; target?: string }>;
	unknown: boolean;
}
