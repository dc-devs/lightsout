import { normalizeRole } from './normalizeRole';

export const hasPermission = () => normalizeRole() === 'admin';
