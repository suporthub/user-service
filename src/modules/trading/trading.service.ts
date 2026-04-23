import crypto from 'crypto';
import { prismaRead } from '../../lib/prisma';
import { getRedis } from '../../lib/redis';
import { AppError } from '../../utils/errors';
import { logger } from '../../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CachedGroupConfig {
  version: string;
  symbols: Array<{
    symbol: string;
    instrumentType: string;
    contractSize: number;
    showPoints: number;
    spreadType: string;
    spread: number;
    spreadPip: number;
    swapType: string;
    swapBuy: number;
    swapSell: number;
    commission: number;
    commissionType: string;
    commissionValueType: string;
    marginPct: number;
    marginCalcMode: string;
    minLot: number;
    maxLot: number;
  }>;
}

export interface TradingConfigResponse extends CachedGroupConfig {
  account: {
    leverage: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the explicit group configuration cache, mapping raw DB fields to the
 * strict trading terminal format. Computes an MD5 hash of the symbol array
 * to act as the exact version string for efficient Mobile/Web 304 caching.
 */
export async function buildGroupConfigCache(groupName: string): Promise<CachedGroupConfig> {
  const group = await prismaRead.group.findUnique({
    where: { name: groupName },
    include: {
      symbols: {
        where: { isTradable: true },
        include: { instrument: true },
      },
    },
  });

  if (!group) throw new AppError('GROUP_NOT_FOUND', 404, `Group ${groupName} not found.`);

  const mappedSymbols = group.symbols.map((s) => ({
    symbol: s.symbol,
    instrumentType: s.instrument.instrumentType,
    contractSize: Number(s.instrument.contractSize),
    showPoints: s.instrument.showPoints,
    spreadType: s.spreadType,
    spread: Number(s.spread),
    spreadPip: Number(s.spreadPip),
    swapType: s.swapType,
    swapBuy: Number(s.swapBuy),
    swapSell: Number(s.swapSell),
    commission: Number(s.commission),
    commissionType: s.commissionType,
    commissionValueType: s.commissionValueType,
    marginPct: Number(s.marginPct),
    marginCalcMode: s.marginCalcMode,
    minLot: Number(s.minLot),
    maxLot: Number(s.maxLot),
  }));

  // Create an ETag / version using an MD5 hash of the payload
  const version = crypto.createHash('md5').update(JSON.stringify(mappedSymbols)).digest('hex');

  const cachePayload: CachedGroupConfig = { version, symbols: mappedSymbols };

  // Event-driven caching: Store indefinitely, clear on admin update.
  const redisKey = `trading:group_config:${groupName}`;
  const redis = getRedis();
  await redis.set(redisKey, JSON.stringify(cachePayload));

  logger.info({ groupName, version, symbolCount: mappedSymbols.length }, 'Rebuilt Group Trading Config Cache');
  
  return cachePayload;
}

/**
 * Fetches the trading config. Separates the account-level variables
 * (like leverage) from the group-level variables (like symbols).
 */
export async function getTradingConfig(accountNumber: string): Promise<TradingConfigResponse> {
  // 1. Resolve Account specific context (leverage + groupName)
  const account = await prismaRead.liveUser.findUnique({
    where: { accountNumber },
    select: { leverage: true, groupName: true },
  });

  if (!account) throw new AppError('ACCOUNT_NOT_FOUND', 404, 'Trading account not found.');

  const redisKey = `trading:group_config:${account.groupName}`;
  const redis = getRedis();
  
  let cachedConfigStr: string | null = null;
  try {
    cachedConfigStr = await redis.get(redisKey);
  } catch (err) {
    logger.warn({ err }, 'Redis get error for trading:group_config');
  }

  let groupConfig: CachedGroupConfig;

  if (cachedConfigStr) {
    try {
      groupConfig = JSON.parse(cachedConfigStr) as CachedGroupConfig;
    } catch {
      // In case of corruption
      groupConfig = await buildGroupConfigCache(account.groupName);
    }
  } else {
    // Cache miss
    groupConfig = await buildGroupConfigCache(account.groupName);
  }

  return {
    version: groupConfig.version,
    account: {
      leverage: account.leverage,
    },
    symbols: groupConfig.symbols,
  };
}

/**
 * Triggered by the Admin API when a group or symbol constraint is updated.
 * Deletes the Redis key forcing a transparent rebuild on the next terminal request.
 */
export async function invalidateGroupConfig(groupName: string): Promise<void> {
  const redisKey = `trading:group_config:${groupName}`;
  const redis = getRedis();
  
  await redis.del(redisKey);
  logger.info({ groupName }, 'Invalidated Group Trading Config Cache');

  // TODO: Publish Kafka event for websocket broadcasting
  // e.g. await publishEvent('trading.config.events', groupName, { type: 'CONFIG_UPDATED', groupName });
}
