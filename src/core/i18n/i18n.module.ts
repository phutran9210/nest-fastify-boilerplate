import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AcceptLanguageResolver,
  HeaderResolver,
  I18nJsonLoader,
  I18nModule,
  QueryResolver,
} from 'nestjs-i18n';
import type { Env } from '../config/env.schema';

// Bọc nestjs-i18n: một JSON loader đọc src/i18n/<lang>/<namespace>.json (sau build là
// dist/src/i18n). Locale resolve theo thứ tự: ?lang=/l → header x-lang → Accept-Language.
// fallbackLanguage lấy từ env. I18nModule tự đăng ký global nên I18nService dùng được toàn app.
@Global()
@Module({
  imports: [
    I18nModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        fallbackLanguage: config.get('FALLBACK_LANGUAGE', { infer: true }),
        loaders: [
          new I18nJsonLoader({
            path: join(__dirname, '..', '..', 'i18n'),
            watch: config.get('NODE_ENV', { infer: true }) !== 'production',
          }),
        ],
      }),
      // `resolvers` PHẢI nằm ở cấp này, KHÔNG nằm trong return của useFactory: kiểu trả về của
      // useFactory là I18nOptionsWithoutResolvers (Omit 'resolvers') nên resolvers đặt trong đó bị
      // bỏ qua lúc runtime → không resolve được locale (luôn rơi về fallback). Thứ tự ưu tiên:
      // ?lang=/l → header x-lang → Accept-Language.
      resolvers: [
        new QueryResolver(['lang', 'l']),
        new HeaderResolver(['x-lang']),
        AcceptLanguageResolver,
      ],
    }),
  ],
})
export class CoreI18nModule {}
