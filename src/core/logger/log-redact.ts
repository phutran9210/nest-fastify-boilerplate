// Đường dẫn dữ liệu nhạy cảm bị che thành "[Redacted]" trong MỌI log.
// pino-http log req/res headers theo mặc định; các path `*.x` bắt cả object do app tự log
// (vd logger.info({ user: { password } })). Bổ sung field mới vào đây khi cần.
export const REDACT_PATHS: string[] = [
  // HTTP headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  // Request body (nếu được log)
  'req.body.password',
  'req.body.passwordConfirmation',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'req.body.accessToken',
  'req.body.refreshToken',
  // Object bất kỳ do app tự log (top-level + 1 cấp lồng)
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.authorization',
];
