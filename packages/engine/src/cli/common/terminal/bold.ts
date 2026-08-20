import { paint } from '#src/cli/common/terminal/paint.ts';

export const bold: (text: string) => string = paint({ code: '1' });
