import { MailProcessor } from '@modules/mail/jobs/mail.processor';

describe('MailProcessor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('process() trả { delivered: true }', async () => {
    const processor = new MailProcessor();
    const job: any = { data: { to: 'a@b.com', subject: 'Hi', body: 'x' } };
    await expect(processor.process(job)).resolves.toEqual({ delivered: true });
  });
});
