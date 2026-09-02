/**
 * One file that travels with a plan: the name it is attached under, and where
 * it sits on disk.
 *
 * Named here rather than beside `durablePlanFiles` because publish names the
 * shape too — a contract with two consumers is a contract, and a caller reaching
 * for it through `ReturnType<>` has no name a reader can search for.
 */
export interface DurablePlanFile {
	name: string;
	/** Absolute path inside the plan's workspace folder. */
	path: string;
}
