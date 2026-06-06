import type { FastifyReply, FastifyRequest } from 'fastify';

// Kiểm tra header `Authorization: Basic <base64(user:pass)>`. Thuần, không phụ thuộc framework.
export function verifyBasicAuth(
  header: string | undefined,
  expectedUser: string,
  expectedPass: string,
): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  return decoded.slice(0, sep) === expectedUser && decoded.slice(sep + 1) === expectedPass;
}

// Tạo Fastify onRequest hook chỉ chặn các request có URL bắt đầu bằng `routePrefix`
// (route Bull Board). Hook ở root instance chạy cho MỌI route kể cả route do plugin tạo.
export function createBullBoardAuthHook(routePrefix: string, user: string, pass: string) {
  return (req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void => {
    if (!req.url.startsWith(routePrefix)) {
      done();
      return;
    }
    if (verifyBasicAuth(req.headers.authorization, user, pass)) {
      done();
      return;
    }
    reply.header('WWW-Authenticate', 'Basic realm="Bull Board"').code(401).send();
  };
}
