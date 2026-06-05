import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ErrorResponseDto } from './error-response.dto';

type EnvelopeOptions = {
  /** HTTP status to document (default 200; use 201 for create routes). */
  status?: number;
  /** When true, `data` is an array and `meta.pagination` is documented (list routes). */
  paginated?: boolean;
};

const metaProperties = (paginated: boolean) => {
  const properties: Record<string, any> = {
    timestamp: { type: 'string' },
    path: { type: 'string' },
    requestId: { type: 'string' },
  };
  if (paginated) {
    properties.pagination = {
      type: 'object',
      properties: {
        page: { type: 'number' },
        limit: { type: 'number' },
        total: { type: 'number' },
        totalPages: { type: 'number' },
        hasNext: { type: 'boolean' },
        hasPrev: { type: 'boolean' },
      },
    };
  }
  return { type: 'object', properties };
};

// Document a success response wrapped in the standard envelope, referencing `model` for `data`.
export function ApiEnvelopeResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: EnvelopeOptions = {},
) {
  const { status = HttpStatus.OK, paginated = false } = options;
  const data = paginated
    ? { type: 'array' as const, items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data,
          meta: metaProperties(paginated),
        },
      },
    }),
  );
}

// Document the error responses the app can actually emit (400/401/404/409/500), all sharing the
// error envelope DTO. 403/422/429 are intentionally omitted — nothing raises them yet (YAGNI).
export function ApiStandardErrorResponses() {
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto),
    ApiBadRequestResponse({ type: ErrorResponseDto }),
    ApiUnauthorizedResponse({ type: ErrorResponseDto }),
    ApiNotFoundResponse({ type: ErrorResponseDto }),
    ApiConflictResponse({ type: ErrorResponseDto }),
    ApiInternalServerErrorResponse({ type: ErrorResponseDto }),
  );
}
