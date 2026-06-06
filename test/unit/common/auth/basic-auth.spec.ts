import { createBullBoardAuthHook, verifyBasicAuth } from '@common/auth/basic-auth';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('verifyBasicAuth', () => {
  it('false khi thiếu header', () => {
    expect(verifyBasicAuth(undefined, 'admin', 'pw')).toBe(false);
  });
  it('false khi không phải scheme Basic', () => {
    expect(verifyBasicAuth('Bearer xyz', 'admin', 'pw')).toBe(false);
  });
  it('false khi sai mật khẩu', () => {
    expect(verifyBasicAuth(`Basic ${b64('admin:wrong')}`, 'admin', 'pw')).toBe(false);
  });
  it('true khi đúng user:pass', () => {
    expect(verifyBasicAuth(`Basic ${b64('admin:pw')}`, 'admin', 'pw')).toBe(true);
  });
  it('true khi mật khẩu chứa dấu hai chấm', () => {
    expect(verifyBasicAuth(`Basic ${b64('admin:pw:with:colons')}`, 'admin', 'pw:with:colons')).toBe(true);
  });
  it('false khi chuỗi giải mã không có dấu hai chấm', () => {
    expect(verifyBasicAuth(`Basic ${b64('adminpw')}`, 'admin', 'pw')).toBe(false);
  });
});

describe('createBullBoardAuthHook', () => {
  function fakeReply() {
    const reply: any = {};
    reply.header = jest.fn().mockReturnValue(reply);
    reply.code = jest.fn().mockReturnValue(reply);
    reply.send = jest.fn().mockReturnValue(reply);
    return reply;
  }

  it('bỏ qua route ngoài prefix (gọi done, không đụng reply)', () => {
    const hook = createBullBoardAuthHook('/admin/queues', 'admin', 'pw');
    const done = jest.fn();
    const reply = fakeReply();
    hook({ url: '/health', headers: {} } as any, reply, done);
    expect(done).toHaveBeenCalledWith();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('401 khi route trong prefix mà thiếu auth', () => {
    const hook = createBullBoardAuthHook('/admin/queues', 'admin', 'pw');
    const done = jest.fn();
    const reply = fakeReply();
    hook({ url: '/admin/queues', headers: {} } as any, reply, done);
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="Bull Board"');
    expect(done).not.toHaveBeenCalled();
  });

  it('cho qua khi route trong prefix và auth đúng', () => {
    const hook = createBullBoardAuthHook('/admin/queues', 'admin', 'pw');
    const done = jest.fn();
    const reply = fakeReply();
    hook(
      { url: '/admin/queues/api', headers: { authorization: `Basic ${b64('admin:pw')}` } } as any,
      reply,
      done,
    );
    expect(done).toHaveBeenCalledWith();
    expect(reply.code).not.toHaveBeenCalled();
  });
});
