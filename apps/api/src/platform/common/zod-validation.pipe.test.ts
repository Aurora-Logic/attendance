import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';

import { ZodValidationPipe, createZodDto } from './zod-validation.pipe.js';

const punchSchema = z.object({
  employeeId: z.uuid(),
  type: z.enum(['IN', 'OUT']),
  reason: z.string().max(200).optional(),
});

class PunchDto extends createZodDto(punchSchema) {}

function bodyMetadata(metatype: ArgumentMetadata['metatype']): ArgumentMetadata {
  return { type: 'body', metatype, data: undefined };
}

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe();

  it('parses and returns the narrowed value for a Zod DTO', () => {
    const input = {
      employeeId: '019ff400-0000-7000-8000-000000000001',
      type: 'IN',
      // Zod strips what the schema does not declare, so an injected field
      // cannot ride along into a service.
      isAdmin: true,
    };

    const result = pipe.transform(input, bodyMetadata(PunchDto));

    expect(result).toEqual({
      employeeId: '019ff400-0000-7000-8000-000000000001',
      type: 'IN',
    });
  });

  it('throws a ZodError the filter can map, not a bare Error', () => {
    expect(() => pipe.transform({ employeeId: 'nope', type: 'SIDEWAYS' }, bodyMetadata(PunchDto)))
      .toThrowError(ZodError);
  });

  it('passes a parameter through untouched when no schema is declared', () => {
    expect(pipe.transform('raw', bodyMetadata(String))).toBe('raw');
    expect(pipe.transform({ a: 1 }, bodyMetadata(Object))).toEqual({ a: 1 });
    expect(pipe.transform(undefined, bodyMetadata(undefined))).toBeUndefined();
  });

  it('ignores a class that merely has a property called zodSchema', () => {
    class Impostor {
      static readonly zodSchema = 'not a schema';
    }
    expect(pipe.transform({ untouched: true }, bodyMetadata(Impostor))).toEqual({
      untouched: true,
    });
  });
});
