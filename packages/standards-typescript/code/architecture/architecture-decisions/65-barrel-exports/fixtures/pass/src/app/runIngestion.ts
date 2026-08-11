import { ingestRecords } from '../ingestion';

export const runIngestion = ({ rows }: { rows: string[] }): string[] => ingestRecords({ rows });
