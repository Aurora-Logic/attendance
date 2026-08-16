import { goToQuerySchema } from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';

export class GoToQueryDto extends createZodDto(goToQuerySchema) {}
