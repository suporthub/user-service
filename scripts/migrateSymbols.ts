import { PrismaClient, InstrumentType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function mapInstrumentType(val: number): InstrumentType {
  // Mapping based on the integers found in your CSV:
  // 1 = forex, 2 = commodity, 3 = index (like AUS200), 4 = crypto (like BTCUSD)
  switch(val) {
    case 1: return InstrumentType.forex;
    case 2: return InstrumentType.commodity;
    case 3: return InstrumentType.index;
    case 4: return InstrumentType.crypto;
    default: return InstrumentType.forex;
  }
}

async function main() {
  const csvPath = path.join(__dirname, '../../docs/Symbols.csv');
  console.log(`Reading Symbols CSV from: ${csvPath}`);
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Could not find CSV file at ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  const dataLines = lines.slice(1);
  console.log(`Found ${dataLines.length} symbols to migrate...`);

  for (const line of dataLines) {
    // Expected header: ID,symbol,name,description,instrument,contractSize,profitCurrency,pipCurrency,pips,showPoints
    const [id, symbol, name, description, instrumentTypeStr, contractSizeStr, profitCurrency, pipCurrency, pipsStr, showPointsStr] = line.split(',');
    
    if (!symbol) continue;

    const instrumentType = mapInstrumentType(parseInt(instrumentTypeStr, 10) || 1);
    const contractSize = parseFloat(contractSizeStr) || 100000;
    // Some CSV lines have empty pips or 10, which we should safely parse.
    const pips = parseFloat(pipsStr) || 0; // The schema handles default 0.0001 if not provided, but we take explicit if any.
    const showPoints = parseInt(showPointsStr, 10) || 5;
    
    // We purposefully ignore the `ID` from CSV.
    // Why? Because Prisma is configured with `symbol` as the Natural Key (`@id`). 
    // You don't need a UUID for an Instrument because "EURUSD" is already universally unique!
    
    const instrument = await prisma.instrument.upsert({
      where: { symbol },
      update: {
        name: name || null,
        description: description || null,
        instrumentType,
        contractSize,
        profitCurrency: profitCurrency || 'USD',
        pipCurrency: pipCurrency || null,
        pips: pips > 0 ? pips : 0.0001, // fallback to standard 0.0001 if zero or blank
        showPoints,
      },
      create: {
        symbol,
        name: name || null,
        description: description || null,
        instrumentType,
        contractSize,
        profitCurrency: profitCurrency || 'USD',
        pipCurrency: pipCurrency || null,
        pips: pips > 0 ? pips : 0.0001, // fallback
        showPoints,
      }
    });
    
    console.log(`✅ Upserted instrument: ${symbol} (Type: ${instrumentType})`);
  }
  
  console.log('🎉 Migration completed successfully.');
}

main()
  .catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
