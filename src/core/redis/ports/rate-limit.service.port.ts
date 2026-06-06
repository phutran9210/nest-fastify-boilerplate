export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms slot sớm nhất rời cửa sổ = oldest_hit + window
}

export abstract class RateLimitService {
  abstract hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}
