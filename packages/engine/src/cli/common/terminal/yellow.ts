import { paint } from '@/cli/common/terminal/paint';

export const yellow: (text: string) => string = paint({ code: '33' });
