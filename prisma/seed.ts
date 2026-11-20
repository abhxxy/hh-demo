// `npx prisma db seed` / `npm run seed` — re-seeds the demo data.
// Run with DATABASE_URL set, e.g. DATABASE_URL=file:./dev.db npm run seed
import { seedDemo } from "../src/lib/seed";

async function main() {
  await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
