-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Hold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "extraType" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Hold_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Hold" ("amount", "expiresAt", "extraType", "id", "reservationId", "slot", "status") SELECT "amount", "expiresAt", "extraType", "id", "reservationId", "slot", "status" FROM "Hold";
DROP TABLE "Hold";
ALTER TABLE "new_Hold" RENAME TO "Hold";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
