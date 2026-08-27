/** One lane's full tree at one frame, replayed from the deltas: path → lines, path → entries. */
export interface SprawlLaneState {
	files: Map<string, number>;
	folders: Map<string, number>;
	overCap: number;
}
