import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  // Resolve the path to the docs directory from user-service/scripts
  const csvPath = path.join(__dirname, '../../docs/Groups.csv');
  console.log(`Reading Groups CSV from: ${csvPath}`);
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Could not find CSV file at ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // The header line is: id,name,description,isActive,accountVariant,displayMultiplier
  const dataLines = lines.slice(1);
  
  console.log(`Found ${dataLines.length} groups to migrate...`);

  for (const line of dataLines) {
    // Basic CSV splitting (assuming no commas inside quotes)
    const [id, name, description, isActiveStr, accountVariant, displayMultiplierStr] = line.split(',');
    
    if (!name) continue;
    
    const isActive = isActiveStr === '1' || isActiveStr?.toLowerCase() === 'true';
    const displayMultiplier = parseInt(displayMultiplierStr, 10) || 1;
    
    // We purposefully IGNORE the 'id' field from the CSV and let Postgres generate a UUID.
    // Using upsert ensures we don't create duplicates if run multiple times
    const group = await prisma.group.upsert({
      where: { name },
      update: {
        description: description || null,
        isActive,
        accountVariant: accountVariant || 'standard',
        displayMultiplier,
      },
      create: {
        name,
        description: description || null,
        isActive,
        accountVariant: accountVariant || 'standard',
        displayMultiplier,
      }
    });
    
    console.log(`✅ Upserted group: ${name} -> Generated UUID: ${group.id}`);
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
