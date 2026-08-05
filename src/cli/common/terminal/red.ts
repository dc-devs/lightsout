import { paint } from '@/cli/common/terminal/paint';

export const red: (text: string) => string = paint({ code: '31' });
