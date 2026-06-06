export abstract class PubSubService {
  abstract publish<T>(channel: string, message: T): Promise<void>;
  abstract subscribe<T>(channel: string, handler: (message: T) => void): Promise<void>;
  abstract unsubscribe(channel: string): Promise<void>;
}
