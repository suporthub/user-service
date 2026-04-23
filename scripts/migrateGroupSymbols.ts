import { PrismaClient, CommissionType, CommissionValueType, SwapType, MarginCalcMode } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Your exact Group names in the exact order they appear sequentially in the CSV blocks
const GROUP_NAMES_IN_ORDER = ['Standard', 'Royal+', 'Classic', 'ECN', 'VIP', 'Elite'];

// Map the integers (0, 1, 2) from your CSV to the newly defined industry-standard strings!
function mapCommissionType(val: number): CommissionType {
  if (val === 0) return CommissionType.round_turn;
  if (val === 1) return CommissionType.entry_only;
  if (val === 2) return CommissionType.exit_only;
  return CommissionType.round_turn;
}

function mapCommissionValueType(val: number): CommissionValueType {
  if (val === 0) return CommissionValueType.per_lot;
  if (val === 1) return CommissionValueType.percentage;
  return CommissionValueType.per_lot;
}

function mapMarginCalcMode(symbol: string): MarginCalcMode {
  // Assign exact marginCalcMode strings based on known crypto/index identifiers
  if (['BTCUSD', 'USDTUSD'].includes(symbol)) return MarginCalcMode.crypto;
  if (['AUS200', 'D30', 'DE30', 'FR40', 'HKG50', 'IND50', 'JP225', 'UK100', 'US100', 'US2000', 'US30', 'US500', 'W20'].includes(symbol)) return MarginCalcMode.cfd_index;
  return MarginCalcMode.standard;
}

async function main() {
  const csvPath = path.join(__dirname, '../../docs/groups1.csv');
  console.log(`Reading GroupSymbols CSV from: ${csvPath}`);
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Could not find CSV file at ${csvPath}`);
  }

  // Pre-fetch all groups from the DB so we have their generated UUIDs!
  console.log('Fetching freshly generated Group UUIDs from DB...');
  const allGroups = await prisma.group.findMany();
  const groupMap = new Map<string, string>(); // name -> UUID
  
  for (const group of allGroups) {
    groupMap.set(group.name, group.id);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').map(line => line.trim());
  const dataLines = lines.slice(1);
  
  let currentGroupIndex = 0;
  let insideValidBlock = false;
  let successCount = 0;

  for (const line of dataLines) {
    const parts = line.split(',');
    const symbol = parts[2] ? parts[2].trim() : null;
    
    // If we hit an empty row (like ",,,,,") we know the block is ending
    if (!symbol) {
      if (insideValidBlock) {
        currentGroupIndex++;
        insideValidBlock = false; // reset until we hit the next valid symbol
      }
      continue;
    }
    
    // Safety check just in case the file has trailing lines
    if (currentGroupIndex >= GROUP_NAMES_IN_ORDER.length) {
      break; 
    }

    insideValidBlock = true;
    
    // What group does this row belong to?
    const groupName = GROUP_NAMES_IN_ORDER[currentGroupIndex];
    // We magically look up the UUID!
    const groupId = groupMap.get(groupName);
    
    if (!groupId) {
      console.warn(`WARNING: Group ID not found for ${groupName} in DB! Did you run migrateGroups.ts?`);
      continue;
    }

    // Map CSV Fields
    const spreadType = parts[3] ? parts[3] : 'variable';
    const spread = parseFloat(parts[4]) || 0;
    const spreadPip = parseFloat(parts[5]) || 0.0001;
    const maxSpread = parts[6] ? parseFloat(parts[6]) : null;
    
    const swapBuy = parseFloat(parts[7]) || 0;
    const swapSell = parseFloat(parts[8]) || 0;
    const swapType = parts[9] === "noswap" ? SwapType.noswap : SwapType.points; // Most of your CSV is blank which implies points
    
    const commission = parseFloat(parts[10]) || 0;
    const commissionType = mapCommissionType(parseInt(parts[11], 10));
    const commissionValueType = mapCommissionValueType(parseInt(parts[12], 10));
    
    const marginPct = parseFloat(parts[13]) || 1;
    const marginCalcMode = mapMarginCalcMode(symbol);
    
    const minLot = parseFloat(parts[16]) || 0.01;
    const maxLot = parseFloat(parts[17]) || 100;
    const lotStep = parseFloat(parts[18]) || 0.01;
    
    const deviation = parseFloat(parts[19]) || 0;
    const bonus = parseFloat(parts[20]) || 0;
    const isTradable = parseInt(parts[21], 10) === 1;

    try {
      await prisma.groupSymbol.upsert({
        where: {
          groupId_symbol: { groupId, symbol }
        },
        update: {
          spreadType, spread, spreadPip, maxSpread,
          swapBuy, swapSell, swapType,
          commission, commissionType, commissionValueType,
          marginPct, marginCalcMode,
          minLot, maxLot, lotStep, deviation, bonus, isTradable
        },
        create: {
          groupId, symbol,
          spreadType, spread, spreadPip, maxSpread,
          swapBuy, swapSell, swapType,
          commission, commissionType, commissionValueType,
          marginPct, marginCalcMode,
          minLot, maxLot, lotStep, deviation, bonus, isTradable
        }
      });
      successCount++;
    } catch (e) {
      console.error(`Failed to map ${symbol} into ${groupName}:`, e);
    }
  }

  console.log(`🎉 Group_Symbols Migration complete! Successfully processed ${successCount} entries using Database UUIDs.`);
}

main()
  .catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
