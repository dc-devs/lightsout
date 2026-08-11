import { paint } from '@/cli/common/terminal/paint';

export const dim: (text: string) => string = paint({ code: '2' });
