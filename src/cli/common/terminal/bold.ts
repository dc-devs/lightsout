import { paint } from '@/cli/common/terminal/paint';

export const bold: (text: string) => string = paint({ code: '1' });
