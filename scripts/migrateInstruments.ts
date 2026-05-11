import { PrismaClient, InstrumentType, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function cleanDecimal(val: string): string {
  if (!val || val.trim() === '') return '0';
  const trimmed = val.trim();
  const parts = trimmed.split('.');
  if (parts.length > 2) {
    return parts[0] + '.' + parts.slice(1).join('');
  }
  if (trimmed.startsWith('.')) return '0' + trimmed;
  if (trimmed.startsWith('-.')) return '-0.' + trimmed.substring(2);
  return trimmed;
}

const typeMap: Record<string, InstrumentType> = {
  '1': 'forex',
  '2': 'commodity',
  '3': 'index',
  '4': 'crypto'
};

async function main() {
  const csvPath = path.join(__dirname, '../../docs/Symbols.csv');
  console.log(`Reading Symbols CSV from: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`Could not find CSV file at ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0).slice(1);

  console.log('🗑️  Erasing existing instrument data...');
  await prisma.instrument.deleteMany();

  const dataToInsert = [];
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 2) continue;

    const [id, symbol, name, description, type, contractSize, profitCurrency, pipCurrency, pips, showPoints] = parts;
    
    let symbolToUse = symbol.trim();
    if (symbolToUse === 'GER30') symbolToUse = 'GER40';

    dataToInsert.push({
      symbol: symbolToUse,
      name: name?.trim() || null,
      description: description?.trim() || null,
      instrumentType: typeMap[type] || 'forex',
      contractSize: new Prisma.Decimal(cleanDecimal(contractSize)),
      profitCurrency: profitCurrency?.trim() || 'USD',
      pipCurrency: pipCurrency?.trim() || null,
      pips: new Prisma.Decimal(cleanDecimal(pips)),
      showPoints: parseInt(showPoints, 10) || 5,
    });
  }

  if (dataToInsert.length > 0) {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < dataToInsert.length; i += CHUNK_SIZE) {
        const chunk = dataToInsert.slice(i, i + CHUNK_SIZE);
        await prisma.instrument.createMany({
            data: chunk,
            skipDuplicates: true,
        });
    }
  }
  
  console.log('🎉 Instrument migration completed successfully.');
}

main()
  .catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
