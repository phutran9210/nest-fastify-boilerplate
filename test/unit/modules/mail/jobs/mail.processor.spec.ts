import { mailWorkerConcurrency, MailProcessor } from '@modules/mail/jobs/mail.processor';

describe('MailProcessor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('process() trả { delivered: true }', async () => {
    const processor = new MailProcessor();
    const job: any = { data: { to: 'a@b.com', subject: 'Hi', body: 'x' } };
    await expect(processor.process(job)).resolves.toEqual({ delivered: true });
  });
});

describe('mailWorkerConcurrency', () => {
  const original = process.env.MAIL_WORKER_CONCURRENCY;
  afterEach(() => {
    if (original === undefined) delete process.env.MAIL_WORKER_CONCURRENCY;
    else process.env.MAIL_WORKER_CONCURRENCY = original;
  });

  it('mặc định 5 khi không set', () => {
    delete process.env.MAIL_WORKER_CONCURRENCY;
    expect(mailWorkerConcurrency()).toBe(5);
  });
  it('đọc giá trị hợp lệ từ env', () => {
    process.env.MAIL_WORKER_CONCURRENCY = '8';
    expect(mailWorkerConcurrency()).toBe(8);
  });
  it('fallback 5 khi giá trị không hợp lệ', () => {
    process.env.MAIL_WORKER_CONCURRENCY = 'oops';
    expect(mailWorkerConcurrency()).toBe(5);
  });
});
