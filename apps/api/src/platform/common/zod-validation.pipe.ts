import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';

/**
 * Definition of Done: "Zod schema validates every request body". A pipe wired
 * per-handler is a pipe someone forgets, so validation is registered globally
 * and driven off the declared parameter type: annotate `@Body()` with a DTO
 * built by `createZodDto` and the body is parsed and narrowed before the
 * controller runs.
 *
 * The pipe throws the raw `ZodError`; `AppExceptionFilter` turns it into the
 * §6 envelope with per-field details. Mapping in one place means a schema used
 * by a pipe, a job payload, or a Tally import all report failure identically.
 */

const SCHEMA_KEY = 'zodSchema';

export type ZodDto<TSchema extends ZodType> = {
  new (): z.output<TSchema>;
  readonly [SCHEMA_KEY]: TSchema;
};

export function createZodDto<TSchema extends ZodType>(schema: TSchema): ZodDto<TSchema> {
  class Dto {
    static readonly [SCHEMA_KEY] = schema;
  }
  // The class is never instantiated -- Nest only reads it as a metatype -- so
  // its instance side is declared as the schema's output type.
  return Dto as unknown as ZodDto<TSchema>;
}

function schemaOf(metatype: ArgumentMetadata['metatype']): ZodType | null {
  if (typeof metatype !== 'function') return null;
  if (!(SCHEMA_KEY in metatype)) return null;
  const schema: unknown = metatype[SCHEMA_KEY];
  return schema instanceof z.ZodType ? schema : null;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = schemaOf(metadata.metatype);
    // A plain `string` or `Object` metatype means the handler declared no
    // contract. Passing through is correct here; the endpoint's own review is
    // where a missing DTO gets caught.
    if (schema === null) return value;

    const result = schema.safeParse(value);
    if (!result.success) throw result.error;
    return result.data;
  }
}
