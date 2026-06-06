import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@generated/prisma/client';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

// Tx client = phần PrismaClient không có $transaction/$connect... Dùng kiểu rộng để tránh phụ thuộc tên.
type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$transaction' | '$on' | '$extends'
>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Lazy: Object.create bỏ qua constructor, nên KHÔNG dùng field initializer.
  // alsStore getter khởi tạo _als khi truy cập lần đầu → an toàn với Object.create.
  private _als?: AsyncLocalStorage<TxClient>;
  private get alsStore(): AsyncLocalStorage<TxClient> {
    this._als ??= new AsyncLocalStorage<TxClient>();
    return this._als;
  }

  // Prisma trả về một Proxy từ constructor; model delegate (user, outboxEvent…) CHỈ tồn tại
  // qua get-handler của Proxy, KHÔNG có trên target thô. Getter (như `db`) lại chạy với
  // `this` = target thô (Prisma đọc accessor bằng `target[prop]`), nên `?? this` sẽ trả client
  // KHÔNG có delegate. Giữ lại tham chiếu tới chính Proxy (`this` ngay sau super()) để `db`
  // trả client có delegate khi NGOÀI transaction. (Object.create bỏ qua constructor → undefined
  // → fallback `this`, đủ cho unit test.)
  private proxied?: PrismaClient;

  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({ connectionString: config.getOrThrow<string>('DATABASE_URL') }),
    });
    this.proxied = this;
  }

  // Repo dùng `this.prisma.db.user...` thay cho `this.prisma.user...`:
  // trong transaction → tx client; ngoài → client Proxy (có model delegate).
  get db(): TxClient {
    return this.alsStore.getStore() ?? ((this.proxied ?? this) as unknown as TxClient);
  }

  // Chạy fn trong 1 transaction tương tác; mọi repo dùng `db` bên trong đều atomic.
  // options: nới timeout cho tác vụ nhiều bước (outbox relay) — mặc định Prisma chỉ 5s.
  runInTransaction<T>(
    fn: () => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this.$transaction((tx) => this.alsStore.run(tx as TxClient, fn), options);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
