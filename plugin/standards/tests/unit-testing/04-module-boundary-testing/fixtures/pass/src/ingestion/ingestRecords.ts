import { normalizeRecord } from './common/utils/normalizeRecord';

export const ingestRecords = ({ raw }: { raw: string[] }): string[] => raw.map((record) => normalizeRecord({ raw: record }));
