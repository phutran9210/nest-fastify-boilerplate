import { z } from 'zod';

export const userRegisteredSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
  name: z.string().optional(),
});
export type UserRegistered = z.infer<typeof userRegisteredSchema>;

export const notificationCreatedSchema = z.object({
  userId: z.string(),
  message: z.string(),
});
export type NotificationCreated = z.infer<typeof notificationCreatedSchema>;

// Single source of truth: routingKey → schema.
export const EventContracts = {
  'user.registered': userRegisteredSchema,
  'notification.created': notificationCreatedSchema,
} as const;

export type EventRoutingKey = keyof typeof EventContracts;
export type EventPayload<K extends EventRoutingKey> = z.infer<(typeof EventContracts)[K]>;

// Ai nghe event nào → drive cả khai báo topology lẫn consumer. Thêm subscriber = thêm 1 dòng.
export const SUBSCRIPTIONS = [
  { subscriber: 'mail', event: 'user.registered' },
  { subscriber: 'notifications', event: 'notification.created' },
] as const satisfies ReadonlyArray<{ subscriber: string; event: EventRoutingKey }>;
