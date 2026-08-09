import { useMemo } from 'react';
import { hasPermission } from '@scope/shared/permissions/utils/hasPermission';

export const useHasPermission = () => useMemo(hasPermission, []);
