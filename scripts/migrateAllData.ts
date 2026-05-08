// import { PrismaClient, InstrumentType, CommissionType, CommissionValueType, SwapType, MarginCalcMode } from '@prisma/client';
// import * as fs from 'fs';
// import * as path from 'path';

// const prisma = new PrismaClient();

// // Helper to map InstrumentType from CSV
// function mapInstrumentType(val: number): InstrumentType {
//   if (val === 1) return InstrumentType.forex;
//   if (val === 2) return InstrumentType.commodity;
//   if (val === 3) return InstrumentType.index;
//   if (val === 4) return InstrumentType.crypto;
//   return InstrumentType.forex; // default
// }

// function mapMarginCalcMode(instType: InstrumentType): MarginCalcMode {
//   switch (instType) {
//     case InstrumentType.crypto: return MarginCalcMode.crypto;
//     case InstrumentType.index: return MarginCalcMode.cfd_index;
//     case InstrumentType.forex:
//     case InstrumentType.commodity:
//     default:
//       return MarginCalcMode.standard;
//   }
// }

// function mapCommissionType(val: number): CommissionType {
//   if (val === 0) return CommissionType.round_turn;
//   if (val === 1) return CommissionType.entry_only;
//   if (val === 2) return CommissionType.exit_only;
//   return CommissionType.round_turn;
// }

// function mapCommissionValueType(val: number): CommissionValueType {
//   if (val === 0) return CommissionValueType.per_lot;
//   if (val === 1) return CommissionValueType.percentage;
//   return CommissionValueType.per_lot;
// }

// async function migrateInstruments() {
//   const csvPath = path.join(__dirname, '../../docs/Symbols (2).csv');
//   console.log(`Reading Instruments CSV from: ${csvPath}`);
  
//   if (!fs.existsSync(csvPath)) {
//     throw new Error(`Could not find CSV file at ${csvPath}`);
//   }

//   const content = fs.readFileSync(csvPath, 'utf-8');
//   const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
//   const dataLines = lines.slice(1);
  
//   let successCount = 0;

//   for (const line of dataLines) {
//     const parts = line.split(',');
//     const symbol = parts[1]?.trim();
//     if (!symbol) continue;

//     const name = parts[2] || null;
//     const description = parts[3] || null;
//     const instrumentType = mapInstrumentType(parseInt(parts[4], 10));
//     const contractSize = parseFloat(parts[5]) || 100000;
//     const profitCurrency = parts[6] || 'USD';
//     const pipCurrency = parts[7] || null;
//     const pips = parseFloat(parts[8]) || 0.0001;
//     const showPoints = parseInt(parts[9], 10) || 5;

//     try {
//       await prisma.instrument.create({
//         data: {
//           symbol, name, description, instrumentType, contractSize, profitCurrency, pipCurrency, pips, showPoints
//         }
//       });
//       successCount++;
//     } catch (e) {
//       console.error(`Failed to insert Instrument ${symbol}:`, e);
//     }
//   }
//   console.log(`Migrated ${successCount} Instruments.`);
// }

// async function migrateGroupSymbols() {
//   const groups = await prisma.group.findMany();
//   const groupMap = new Map<string, string>();
//   for (const group of groups) {
//     groupMap.set(group.name.toLowerCase(), group.id);
//   }

//   const fileMappings = [
//     { file: 'classic group.csv', dbName: 'classic' },
//     { file: 'ECN group.csv', dbName: 'ecn' },
//     { file: 'Elite group.csv', dbName: 'elite' },
//     { file: 'royal group.csv', dbName: 'royal+' },
//     { file: 'standard group.csv', dbName: 'standard' },
//     { file: 'VIP group.csv', dbName: 'vip' }
//   ];

//   const instruments = await prisma.instrument.findMany({ select: { symbol: true, instrumentType: true } });
//   const instTypeMap = new Map<string, InstrumentType>();
//   for (const inst of instruments) {
//     instTypeMap.set(inst.symbol, inst.instrumentType);
//   }

//   let totalSuccess = 0;

//   for (const mapping of fileMappings) {
//     const csvPath = path.join(__dirname, `../../docs/${mapping.file}`);
//     const groupId = groupMap.get(mapping.dbName);
    
//     if (!groupId) {
//       console.warn(`WARNING: Group ID not found for ${mapping.dbName} in DB!`);
//       continue;
//     }

//     if (!fs.existsSync(csvPath)) {
//       console.warn(`WARNING: File not found: ${csvPath}`);
//       continue;
//     }

//     console.log(`Processing ${mapping.file} for group ${mapping.dbName}...`);
//     const content = fs.readFileSync(csvPath, 'utf-8');
//     const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
//     const dataLines = lines.slice(1);

//     let successCount = 0;

//     for (const line of dataLines) {
//       const parts = line.split(',');
//       const symbol = parts[2]?.trim();
//       if (!symbol) continue;

//       const spreadType = parts[3] ? parts[3] : 'variable';
//       const spread = parseFloat(parts[4]) || 0;
//       const spreadPip = parseFloat(parts[5]) || 0.0001;
//       const maxSpread = parts[6] ? parseFloat(parts[6]) : null;
      
//       const swapBuy = parseFloat(parts[7]) || 0;
//       const swapSell = parseFloat(parts[8]) || 0;
//       const swapType = parts[9] === "noswap" ? SwapType.noswap : SwapType.points;
      
//       const commission = parseFloat(parts[10]) || 0;
//       const commissionType = mapCommissionType(parseInt(parts[11], 10));
//       const commissionValueType = mapCommissionValueType(parseInt(parts[12], 10));
      
//       const marginPct = parseFloat(parts[13]) || 1;
      
//       const instType = instTypeMap.get(symbol) || InstrumentType.forex;
//       const marginCalcMode = mapMarginCalcMode(instType);
      
//       const marginFactor = parseFloat(parts[15]) || 1.0;
//       const minLot = parseFloat(parts[16]) || 0.01;
//       const maxLot = parseFloat(parts[17]) || 100;
//       const lotStep = parseFloat(parts[18]) || 0.01;
      
//       const deviation = parseFloat(parts[19]) || 0;
//       const bonus = parseFloat(parts[20]) || 0;
//       const isTradable = parseInt(parts[21], 10) === 1;

//       try {
//         await prisma.groupSymbol.create({
//           data: {
//             groupId, symbol,
//             spreadType, spread, spreadPip, maxSpread,
//             swapBuy, swapSell, swapType,
//             commission, commissionType, commissionValueType,
//             marginPct, marginCalcMode, marginFactor,
//             minLot, maxLot, lotStep, deviation, bonus, isTradable
//           }
//         });
//         successCount++;
//         totalSuccess++;
//       } catch (e) {
//         console.error(`Failed to map ${symbol} into ${mapping.dbName}:`, e);
//       }
//     }
//     console.log(`  -> Migrated ${successCount} symbols for group ${mapping.dbName}.`);
//   }

//   console.log(`🎉 Group_Symbols Migration complete! Successfully processed ${totalSuccess} total entries.`);
// }

// async function main() {
//   console.log('--- Starting Migration ---');
  
//   console.log('1. Deleting existing group_symbols...');
//   await prisma.groupSymbol.deleteMany();
  
//   console.log('2. Deleting existing instruments...');
//   await prisma.instrument.deleteMany();
  
//   console.log('3. Migrating Instruments...');
//   await migrateInstruments();
  
//   console.log('4. Migrating Group Symbols...');
//   await migrateGroupSymbols();
  
//   console.log('--- Migration Finished ---');
// }

// main()
//   .catch(e => {
//     console.error('Migration failed:', e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });
