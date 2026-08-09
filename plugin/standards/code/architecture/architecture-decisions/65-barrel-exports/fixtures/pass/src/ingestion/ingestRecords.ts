import { normalizeRecord } from './common/utils/normalizeRecord';

export const ingestRecords = ({ rows }: { rows: string[] }): string[] => rows.map((row) => normalizeRecord({ row }));
