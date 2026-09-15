/** Fault injection observes completed durable operations; it never substitutes fake storage. */
export interface PlanningStoreIO {
	checkpoint?: (params: { operation: string; path: string }) => Promise<void>;
}
