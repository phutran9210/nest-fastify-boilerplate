import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { MailProducer } from '@modules/mail/jobs/mail.producer';

describe('MailProducer', () => {
  const add = jest.fn();
  let producer: MailProducer;

  beforeEach(async () => {
    jest.clearAllMocks();
    add.mockResolvedValue({ id: 'job-1' });
    const moduleRef = await Test.createTestingModule({
      providers: [MailProducer, { provide: getQueueToken('mail'), useValue: { add } }],
    }).compile();
    producer = moduleRef.get(MailProducer);
  });

  it('enqueue() gọi queue.add đúng tham số và trả job id', async () => {
    const dto = { to: 'a@b.com', subject: 'Hi', body: 'x' };
    const id = await producer.enqueue(dto);
    expect(add).toHaveBeenCalledWith('send', dto, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
    });
    expect(id).toBe('job-1');
  });
});
