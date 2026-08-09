import { normalizeRole } from './common/utils/normalizeRole';

export const hasPermission = () => normalizeRole() === 'admin';
