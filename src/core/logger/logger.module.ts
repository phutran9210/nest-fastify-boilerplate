import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env.schema';
import { REDACT_PATHS } from './log-redact';

type TransportTarget = { target: string; options: Record<string, unknown>; level: string };

// pino-roll xoay khi sang ngày MỚI hoặc file vượt `size` (cái nào tới trước); giữ `maxFiles`
// file gần nhất; removeOtherLogFiles dọn cả file từ lần chạy trước.
function rollTarget(
  dir: string,
  name: string,
  level: string,
  maxFiles: number,
  size: string,
): TransportTarget {
  return {
    target: 'pino-roll',
    options: {
      file: join(dir, name),
      frequency: 'daily',
      size,
      dateFormat: 'yyyy-MM-dd',
      mkdir: true,
      limit: { count: maxFiles, removeOtherLogFiles: true },
    },
    level,
  };
}

// Dựng danh sách đích log: luôn có console; thêm file tổng và/hoặc file lỗi nếu bật.
function buildTargets(p: {
  isProd: boolean;
  level: string;
  fileEnabled: boolean;
  errorFileEnabled: boolean;
  dir: string;
  maxDays: number;
  maxSize: string;
}): { targets: TransportTarget[] } {
  const targets: TransportTarget[] = [
    // Console: dev → pino-pretty (màu, dễ đọc); prod → JSON 1 dòng ra stdout.
    p.isProd
      ? { target: 'pino/file', options: { destination: 1 }, level: p.level }
      : {
          target: 'pino-pretty',
          options: {
            singleLine: true,
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
          level: p.level,
        },
  ];

  // File tổng — mọi log từ `level` trở lên.
  if (p.fileEnabled) targets.push(rollTarget(p.dir, 'app', p.level, p.maxDays, p.maxSize));

  // File lỗi — CHỈ error/fatal. Lỗi vẫn vào cả file tổng (nếu bật) → giữ được tương quan.
  if (p.errorFileEnabled) targets.push(rollTarget(p.dir, 'error', 'error', p.maxDays, p.maxSize));

  return { targets };
}

// Bọc nestjs-pino: cấu hình Pino từ env. req.id lấy từ Fastify genReqId (main.ts) nên log
// khớp header `x-request-id` trả về client. Dữ liệu nhạy cảm bị redact (xem log-redact.ts).
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
        const level = config.get('LOG_LEVEL', { infer: true }) ?? (isProd ? 'info' : 'debug');
        const fileEnabled = config.get('LOG_FILE_ENABLED', { infer: true });
        const errorFileEnabled = config.get('LOG_ERROR_FILE_ENABLED', { infer: true });
        const dir = config.get('LOG_DIR', { infer: true });
        const maxDays = config.get('LOG_FILE_MAX_DAYS', { infer: true });
        const maxSize = config.get('LOG_FILE_MAX_SIZE', { infer: true });

        return {
          pinoHttp: {
            level,
            transport: buildTargets({
              isProd,
              level,
              fileEnabled,
              errorFileEnabled,
              dir,
              maxDays,
              maxSize,
            }),
            redact: REDACT_PATHS,
            // Dùng lại request id Fastify đã set vào header (xem genReqId ở main.ts).
            genReqId: (req) => {
              const header = req.headers['x-request-id'];
              return Array.isArray(header) ? header[0] : (header ?? '');
            },
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
