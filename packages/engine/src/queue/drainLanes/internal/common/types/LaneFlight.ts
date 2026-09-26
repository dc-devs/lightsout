/**
 * The drain's tasks in flight, and how much of the one budget each lane is
 * spending.
 *
 * Each task is keyed by a rising integer it resolves to, so a `Promise.race`
 * over the map says which one finished and the loop can drop just that key.
 */
export interface LaneFlight {
	tasks: Map<number, Promise<number>>;
	builds: number;
	ships: number;
	scans: number;
	nextKey: number;
}
