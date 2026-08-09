import { normalizeRecord } from '../ingestion/common/utils/normalizeRecord';

// The ingestion folder states no public API, so a consumer reaches past the
// concept it wanted and binds itself to an internal instead.
export const runIngestion = ({ rows }: { rows: string[] }): string[] => rows.map((row) => normalizeRecord({ row }));
