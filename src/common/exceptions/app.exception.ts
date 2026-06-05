import type { I18nPath } from '@generated/i18n.generated';
import { HttpException, type HttpStatus } from '@nestjs/common';

// Exception nghiệp vụ mang message KEY (không phải text). HttpExceptionFilter dịch key này
// sang locale của request qua I18nService. `args` để nội suy ({id}, {email}); `code` để override
// mã máy (mặc định filter suy từ HTTP status).
export class AppException extends HttpException {
  constructor(
    readonly messageKey: I18nPath,
    status: HttpStatus,
    readonly args?: Record<string, unknown>,
    readonly code?: string,
  ) {
    super(messageKey, status);
  }
}
