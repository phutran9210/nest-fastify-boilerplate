import { createBullBoard } from '@bull-board/api';
import { FastifyAdapter } from '@bull-board/fastify';
import { createBullBoardAuthHook } from '@common/auth/basic-auth';
import Fastify, { type FastifyInstance } from 'fastify';

// Dựng standalone Fastify + plugin Bull Board (queues rỗng, KHÔNG cần Redis) để kiểm chứng
// onRequest hook ở root instance thực sự chặn được route do plugin Bull Board đăng ký.
describe('Bull Board auth (Fastify onRequest hook)', () => {
  const ROUTE = '/admin/queues';
  const USER = 'admin';
  const PASS = 'secret';
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.addHook('onRequest', createBullBoardAuthHook(ROUTE, USER, PASS));
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath(ROUTE);
    createBullBoard({ queues: [], serverAdapter });
    await app.register(serverAdapter.registerPlugin(), { prefix: ROUTE });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('401 khi không có credentials', async () => {
    const res = await app.inject({ method: 'GET', url: ROUTE });
    expect(res.statusCode).toBe(401);
    expect(String(res.headers['www-authenticate'])).toContain('Basic');
  });

  it('vào được (2xx/3xx) khi Basic Auth đúng', async () => {
    const authz = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;
    const res = await app.inject({ method: 'GET', url: ROUTE, headers: { authorization: authz } });
    expect(res.statusCode).toBeLessThan(400);
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
  });
});
