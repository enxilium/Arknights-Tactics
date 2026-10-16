import { DataError, getCatalog } from "@/lib/aceship";
import { importOperator } from "@/lib/import-operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  // This local tool writes to disk. Cross-origin pages must not be able to trigger it.
  // Next may use an internal hostname in request.url; the browser uses the Host header.
  const expectedOrigin = `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  if (request.headers.get("origin") !== expectedOrigin) {
    return Response.json(
      { error: "Downloads must be started from this app." },
      { status: 403 },
    );
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json(
      { error: "Expected a JSON selection." },
      { status: 415 },
    );
  }
  try {
    const body = await request.text();
    if (body.length > 2048)
      throw new DataError("The selection is too large.", 413);
    let selection: { operatorId?: unknown; skinId?: unknown };
    try {
      selection = JSON.parse(body);
    } catch {
      throw new DataError("The selection is not valid JSON.", 400);
    }
    if (!selection || typeof selection !== "object")
      throw new DataError("Choose an operator and outfit.", 400);
    const { catalog } = await getCatalog();
    return Response.json(
      await importOperator(catalog, selection.operatorId, selection.skinId),
    );
  } catch (error) {
    console.error("Operator import failed:", error);
    return Response.json(
      {
        error:
          error instanceof DataError
            ? error.message
            : "The download failed. No partial bundle was published; retry the download.",
      },
      { status: error instanceof DataError ? error.status : 500 },
    );
  }
}
