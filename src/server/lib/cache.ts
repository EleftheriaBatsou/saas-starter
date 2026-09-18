import { Redis } from 'ioredis';
import { config } from '../config.ts';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
  db: Number(process.env.REDIS_DB ?? 0),
});
