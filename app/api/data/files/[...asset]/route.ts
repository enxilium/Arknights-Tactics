import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { safeSegment } from "@/lib/aceship";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".atlas": "text/plain; charset=utf-8",
  ".skel": "application/octet-stream",
};

// Read from public at request time so new downloads also work after `next build`.
export async function GET(
  _request: Request,
  context: { params: Promise<{ asset: string[] }> },
) {
  const { asset } = await context.params;
  const extension = path.extname(asset.at(-1) ?? "");
  if (
    asset.length < 3 ||
    asset.length > 4 ||
    !asset.every(safeSegment) ||
    !CONTENT_TYPES[extension]
  ) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const root = await realpath(path.join(process.cwd(), "public/operators"));
    const file = await realpath(path.join(root, ...asset));
    if (!file.startsWith(`${root}${path.sep}`) || !(await stat(file)).isFile())
      return new Response("Not found", { status: 404 });
    const bytes = await readFile(file);
    return new Response(bytes, {
      headers: {
        "Content-Type": CONTENT_TYPES[extension],
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
