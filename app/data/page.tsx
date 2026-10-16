import { DataError, getCatalog, publicCatalog } from "@/lib/aceship";
import DataWorkshop from "./workshop";
import type { CatalogResponse } from "@/lib/data-types";

export const dynamic = "force-dynamic";

export default async function DataPage() {
  let catalog: CatalogResponse | null = null;
  let message = "";
  try {
    catalog = publicCatalog(await getCatalog());
  } catch (error) {
    message =
      error instanceof DataError
        ? error.message
        : "The operator catalog could not be loaded. Try again.";
  }
  return <DataWorkshop initialCatalog={catalog} initialError={message} />;
}
