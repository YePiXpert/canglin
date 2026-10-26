ALTER TABLE "CatalogProduct" ADD COLUMN "catalogVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "CatalogProductAlias" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "productId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "specification" TEXT NOT NULL DEFAULT '',
  "unit" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CatalogProductAlias_name_specification_unit_key" ON "CatalogProductAlias"("name", "specification", "unit");
CREATE INDEX "CatalogProductAlias_productId_idx" ON "CatalogProductAlias"("productId");
