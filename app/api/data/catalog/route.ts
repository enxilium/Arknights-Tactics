import { DataError, getCatalog, publicCatalog } from "@/lib/aceship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const result = await getCatalog(
      new URL(request.url).searchParams.get("refresh") === "1",
    );
    return Response.json(publicCatalog(result), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Catalog load failed:", error);
    return Response.json(
      {
        error:
          error instanceof DataError
            ? error.message
            : "The operator catalog could not be loaded.",
      },
      { status: error instanceof DataError ? error.status : 500 },
    );
  }
}
