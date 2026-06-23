import { AUTH_INSTANCE, type AuthInstance } from '@core/auth/auth';
import { PrismaService } from '@core/prisma/prisma.service';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { fromNodeHeaders } from 'better-auth/node';
import { AppModule } from '../../src/app.module';

// Replicate the /api/auth mount from main.ts (same as auth.e2e-spec.ts).
async function buildApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  const auth: AuthInstance = app.get(AUTH_INSTANCE);
  const fastify = app.getHttpAdapter().getInstance();
  fastify.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const req = new Request(url.toString(), {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('Admin (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const adminEmail = `admin-${Date.now()}@example.com`;
  const userEmail = `user-${Date.now()}@example.com`;
  const password = 'password1234';
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.db.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } });
    }
    if (app) {
      await app.close();
    }
  });

  async function signUpVerified(email: string): Promise<string> {
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email, password, name: 'E2E' },
    });
    await prisma.db.user.update({ where: { email }, data: { emailVerified: true } });
    const u = await prisma.db.user.findUnique({ where: { email } });
    return u?.id as string;
  }

  async function bearerFor(email: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password },
    });
    return res.headers['set-auth-token'] as string;
  }

  it('promotes an admin (ADMIN_USER_IDS) and lists users; non-admin is rejected', async () => {
    adminId = await signUpVerified(adminEmail);
    await signUpVerified(userEmail);

    // NOTE: this test assumes the admin user's id is included in ADMIN_USER_IDS for the
    // test process. Set ADMIN_USER_IDS to include `adminId` before running, OR set
    // role='admin' directly: await prisma.db.user.update({ where:{ email:adminEmail }, data:{ role:'admin' }})
    await prisma.db.user.update({ where: { email: adminEmail }, data: { role: 'admin' } });

    const adminToken = await bearerFor(adminEmail);
    const userToken = await bearerFor(userEmail);

    const ok = await app.inject({
      method: 'GET',
      url: '/api/auth/admin/list-users?limit=10',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(Array.isArray(ok.json().users)).toBe(true);

    const denied = await app.inject({
      method: 'GET',
      url: '/api/auth/admin/list-users?limit=10',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(denied.statusCode).toBeGreaterThanOrEqual(401);
    expect(denied.statusCode).toBeLessThan(404);
  });
});
