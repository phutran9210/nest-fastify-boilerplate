import { PrismaService } from '@core/prisma/prisma.service';
import { fromNodeHeaders } from 'better-auth/node';
import { AppModule } from '../../src/app.module';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AUTH_INSTANCE, type AuthInstance } from '@core/auth/auth';
import { Test } from '@nestjs/testing';

// NOTE: replicate the /api/auth mount from main.ts so the handler exists under test.
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

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'password1234';

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.db.user.deleteMany({ where: { email } });
    }
    if (app) {
      await app.close();
    }
  });

  it('rejects a protected route without credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/users' });
    expect(res.statusCode).toBe(401);
  });

  it('signs up, verifies, signs in (cookie) and reaches /auth/me', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email, password, name: 'E2E' },
    });
    expect(signup.statusCode).toBe(200);

    // requireEmailVerification blocks sign-in until verified — flip it directly in the DB.
    await prisma.db.user.update({ where: { email }, data: { emailVerified: true } });

    const signin = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password },
    });
    expect(signin.statusCode).toBe(200);

    const cookie = signin.headers['set-cookie'];
    expect(cookie).toBeDefined();
    const cookieHeader = Array.isArray(cookie) ? cookie.join('; ') : (cookie as string);

    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: cookieHeader } });
    expect(me.statusCode).toBe(200);
    // ResponseInterceptor wraps Nest route responses in { data: ... }
    expect(me.json().data.email).toBe(email);
  });

  it('authenticates with a bearer token independently of cookies', async () => {
    const signin = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password },
    });
    const token = signin.headers['set-auth-token'] as string;
    expect(token).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    // ResponseInterceptor wraps Nest route responses in { data: ... }
    expect(me.json().data.email).toBe(email);
  });
});
