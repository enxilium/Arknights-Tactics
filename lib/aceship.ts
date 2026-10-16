import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { skillInfo, type SkillLevel } from "./skill-metadata.ts";
import type {
  AssetFile,
  Catalog,
  CatalogResponse,
  Operator,
  SkillPreset,
  ViewName,
} from "./data-types.ts";

const API = "https://api.github.com/repos/Aceship/Arknight-Images";
const TOOLBOX = "https://aceship.github.io/AN-EN-Tags";
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const CACHE_AGE = 60 * 60 * 1000;
const VIEWS: ViewName[] = ["front", "back", "build"];

export class DataError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function safeSegment(value: string): boolean {
  return (
    /^[A-Za-z0-9_@#.+\[\]-]+$/.test(value) && value !== "." && value !== ".."
  );
}

export function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

export async function remoteBytes(
  url: string,
  limit = MAX_FILE_BYTES,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "Arknights-Tactics-local-debugger",
        Accept: "*/*",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch {
    throw new DataError(
      "Could not reach Aceship's files. Check your connection and retry.",
    );
  }
  if (!response.ok) {
    const limited = response.status === 403 || response.status === 429;
    throw new DataError(
      limited
        ? "GitHub's request limit was reached. Try again after the limit resets."
        : `An Aceship source request failed (HTTP ${response.status}). Try refreshing the catalog.`,
    );
  }
  if (!response.body)
    throw new DataError("Aceship returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit)
        throw new DataError("A source file exceeds the import size limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof DataError) throw error;
    throw new DataError(
      "A source download was interrupted. Retry the download.",
    );
  }
  return Buffer.concat(chunks);
}

async function remoteJson<T>(url: string): Promise<T> {
  const bytes = await remoteBytes(url);
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    throw new DataError("An Aceship source returned invalid JSON.");
  }
}

export type TreeEntry = {
  path: string;
  type: string;
  sha: string;
  size?: number;
};
type Tree = { tree: TreeEntry[]; truncated?: boolean };
type Character = {
  name?: string;
  appellation?: string;
  profession?: string;
  skills?: { skillId: string }[];
};
type SkillMetadata = { iconId?: string | null; levels?: SkillLevel[] };
export type SkinMetadata = {
  charId?: string;
  skinId?: string;
  buildingId?: string;
  battleSkin?: { skinOrPrefabId?: string };
  displaySkin?: { skinName?: string | null };
};

async function tree(ref: string): Promise<TreeEntry[]> {
  const data = await remoteJson<Tree>(`${API}/git/trees/${ref}`);
  if (!Array.isArray(data.tree) || data.truncated) {
    throw new DataError(
      "GitHub returned an incomplete sprite inventory. No partial catalog was saved.",
    );
  }
  return data.tree;
}

function subtree(entries: TreeEntry[], name: string): string {
  const entry = entries.find(
    (file) => file.path === name && file.type === "tree",
  );
  if (!entry || !/^[a-f0-9]{40}$/.test(entry.sha)) {
    throw new DataError(`Aceship's ${name} directory was not found.`);
  }
  return entry.sha;
}

// Metadata supplies labels; complete bundles in the repository own availability.
function indexFiles(entries: TreeEntry[]): Record<string, AssetFile> {
  const files: Record<string, AssetFile> = {};
  for (const file of entries) {
    if (file.type !== "blob" || !/\.(skel|json|atlas|png)$/.test(file.path))
      continue;
    if (
      !file.path.split("/").every(safeSegment) ||
      !/^[a-f0-9]{40}$/.test(file.sha) ||
      !Number.isSafeInteger(file.size) ||
      file.size! <= 0 ||
      file.size! > MAX_FILE_BYTES
    )
      continue;
    files[file.path] = { path: file.path, sha: file.sha, size: file.size! };
  }
  return files;
}

export function buildOperators(
  entries: TreeEntry[],
  characters: Record<string, Character>,
  skins: Record<string, SkinMetadata>,
): { operators: Operator[]; files: Record<string, AssetFile> } {
  const files = indexFiles(entries);
  const labels = new Map<string, string>();
  for (const metadata of Object.values(skins)) {
    if (!metadata.charId || !metadata.displaySkin?.skinName) continue;
    for (const id of [
      metadata.battleSkin?.skinOrPrefabId,
      metadata.buildingId,
      metadata.skinId,
    ]) {
      if (id && id !== "DefaultSkin") {
        labels.set(
          `${metadata.charId}/${id.replace(/[@#]/g, "_")}`,
          metadata.displaySkin.skinName,
        );
      }
    }
  }
  const operators = new Map<string, Operator>();
  for (const file of Object.values(files)) {
    if (!/\.(skel|json)$/.test(file.path)) continue;
    const parts = file.path.split("/");
    if (parts.length !== 3) continue;
    const [operatorId, perspective, filename] = parts;
    if (
      !/^char_[A-Za-z0-9_]+$/.test(operatorId) ||
      !VIEWS.includes(perspective as ViewName)
    )
      continue;
    const stem = filename.replace(/\.(skel|json)$/, "");
    const skinId = perspective === "build" ? stem.replace(/^build_/, "") : stem;
    if (skinId !== operatorId && !skinId.startsWith(`${operatorId}_`)) continue;
    const base = `${operatorId}/${perspective}/${stem}`;
    const atlas = files[`${base}.atlas`];
    const texture = files[`${base}.png`];
    if (!atlas || !texture) continue;
    let operator = operators.get(operatorId);
    if (!operator) {
      operator = {
        id: operatorId,
        name:
          characters[operatorId]?.name ||
          characters[operatorId]?.appellation ||
          operatorId,
        skins: [],
        skills: [],
      };
      operators.set(operatorId, operator);
    }
    let skin = operator.skins.find((candidate) => candidate.id === skinId);
    if (!skin) {
      skin = {
        id: skinId,
        name:
          skinId === operatorId
            ? "Default outfit"
            : labels.get(`${operatorId}/${skinId}`) ||
              `Outfit · ${skinId.slice(operatorId.length + 1)}`,
        views: [],
      };
      operator.skins.push(skin);
    }
    const view = {
      name: perspective as ViewName,
      skeleton: file,
      atlas,
      textures: [texture],
    };
    const existing = skin.views.findIndex(
      (candidate) => candidate.name === perspective,
    );
    if (existing < 0) skin.views.push(view);
    else if (file.path.endsWith(".skel")) skin.views[existing] = view;
  }
  for (const operator of operators.values()) {
    operator.skins.sort(
      (a, b) =>
        Number(b.id === operator.id) - Number(a.id === operator.id) ||
        a.name.localeCompare(b.name),
    );
    for (const skin of operator.skins)
      skin.views.sort((a, b) => VIEWS.indexOf(a.name) - VIEWS.indexOf(b.name));
  }
  const nameCounts = new Map<string, number>();
  for (const operator of operators.values())
    nameCounts.set(operator.name, (nameCounts.get(operator.name) ?? 0) + 1);
  const classes: Record<string, string> = {
    CASTER: "Caster",
    WARRIOR: "Guard",
    SNIPER: "Sniper",
    PIONEER: "Vanguard",
    TANK: "Defender",
    MEDIC: "Medic",
    SUPPORT: "Supporter",
    SPECIAL: "Specialist",
  };
  for (const operator of operators.values()) {
    if (nameCounts.get(operator.name)! > 1)
      operator.name += ` (${classes[characters[operator.id]?.profession ?? ""] ?? operator.id})`;
  }
  return {
    operators: [...operators.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    files,
  };
}

export function addOperatorSkills(
  operators: Operator[],
  characters: Record<string, Character>,
  skillTable: Record<string, SkillMetadata>,
  iconEntries: TreeEntry[],
  presets: Record<string, { skills?: SkillPreset[] }>,
): void {
  const icons = indexFiles(iconEntries);
  for (const operator of operators) {
    operator.skills = (characters[operator.id]?.skills ?? []).map(
      ({ skillId }, index) => {
        const metadata = skillTable[skillId];
        const iconId = metadata?.iconId || skillId;
        const filename = `skill_icon_${iconId}.png`;
        return {
          ...skillInfo(skillId, metadata?.levels),
          icon: safeSegment(filename) ? (icons[filename] ?? null) : null,
          preview: presets[operator.id]?.skills?.[index],
        };
      },
    );
  }
}

async function fetchCatalog(): Promise<Catalog> {
  const ref = await remoteJson<{ object: { sha: string } }>(
    `${API}/git/ref/heads/main`,
  );
  const revision = ref.object?.sha;
  if (!revision || !/^[a-f0-9]{40}$/.test(revision))
    throw new DataError("Aceship's asset revision could not be resolved.");
  const root = await tree(revision);
  const spine = await tree(subtree(root, "spineassets"));
  const characterSha = subtree(spine, "character");
  const [
    inventory,
    characters,
    patch,
    skinTable,
    skillTable,
    iconEntries,
    presets,
  ] = await Promise.all([
    remoteJson<Tree>(`${API}/git/trees/${characterSha}?recursive=1`),
    remoteJson<Record<string, Character>>(
      `${TOOLBOX}/json/gamedata/en_US/gamedata/excel/character_table.json`,
    ),
    remoteJson<{ patchChars?: Record<string, Character> }>(
      `${TOOLBOX}/json/gamedata/en_US/gamedata/excel/char_patch_table.json`,
    ),
    remoteJson<{ charSkins: Record<string, SkinMetadata> }>(
      `${TOOLBOX}/json/gamedata/en_US/gamedata/excel/skin_table.json`,
    ),
    remoteJson<Record<string, SkillMetadata>>(
      `${TOOLBOX}/json/gamedata/en_US/gamedata/excel/skill_table.json`,
    ),
    tree(subtree(root, "skills")),
    remoteJson<Record<string, { skills?: SkillPreset[] }>>(
      `${TOOLBOX}/json/ace/animlist.json`,
    ),
  ]);
  if (
    !Array.isArray(inventory.tree) ||
    inventory.truncated ||
    !skinTable.charSkins
  ) {
    throw new DataError(
      "Aceship returned an incomplete catalog. No partial catalog was saved.",
    );
  }
  const { operators, files } = buildOperators(
    inventory.tree,
    { ...characters, ...patch.patchChars },
    skinTable.charSkins,
  );
  addOperatorSkills(
    operators,
    { ...characters, ...patch.patchChars },
    skillTable,
    iconEntries,
    presets,
  );
  if (!operators.length)
    throw new DataError("No complete operator sprite bundles were found.");
  return {
    version: 3,
    revision,
    fetchedAt: new Date().toISOString(),
    operators,
    files,
  };
}

let memory: Catalog | undefined;
let pending: Promise<Catalog> | undefined;

export async function getCatalog(
  refresh = false,
): Promise<{ catalog: Catalog; stale: boolean; warning?: string }> {
  const cachePath = path.join(process.cwd(), ".cache/aceship/catalog.json");
  if (!memory) {
    try {
      const cached: Catalog = JSON.parse(await readFile(cachePath, "utf8"));
      if (
        cached.version === 3 &&
        cached.files &&
        cached.operators?.length &&
        /^[a-f0-9]{40}$/.test(cached.revision)
      )
        memory = cached;
    } catch {
      /* A missing or invalid cache is rebuilt from upstream. */
    }
  }
  if (
    !refresh &&
    memory &&
    Date.now() - Date.parse(memory.fetchedAt) < CACHE_AGE
  ) {
    return { catalog: memory, stale: false };
  }
  if (!pending) {
    pending = (async () => {
      const catalog = await fetchCatalog();
      await mkdir(path.dirname(cachePath), { recursive: true });
      const temporary = `${cachePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(catalog));
      await rename(temporary, cachePath);
      memory = catalog;
      return catalog;
    })();
  }
  try {
    return { catalog: await pending, stale: false };
  } catch (error) {
    if (memory)
      return {
        catalog: memory,
        stale: true,
        warning:
          error instanceof DataError
            ? error.message
            : "Catalog refresh failed. Showing the saved inventory.",
      };
    throw error;
  } finally {
    pending = undefined;
  }
}

export function publicCatalog(
  result: Awaited<ReturnType<typeof getCatalog>>,
): CatalogResponse {
  return {
    fetchedAt: result.catalog.fetchedAt,
    stale: result.stale,
    warning: result.warning,
    operators: result.catalog.operators.map((operator) => ({
      id: operator.id,
      name: operator.name,
      skins: operator.skins.map((skin) => ({
        id: skin.id,
        name: skin.name,
        views: skin.views.map((view) => view.name),
        bytes: skin.views.reduce(
          (sum, view) =>
            sum +
            view.skeleton.size +
            view.atlas.size +
            view.textures.reduce((bytes, file) => bytes + file.size, 0),
          [
            ...new Map(
              operator.skills.flatMap((skill) =>
                skill.icon ? [[skill.icon.path, skill.icon] as const] : [],
              ),
            ).values(),
          ].reduce((sum, icon) => sum + icon.size, 0),
        ),
      })),
    })),
  };
}

export function atlasPages(atlas: string): string[] {
  const pages = atlas
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.split(/\r?\n/)[0].trim());
  if (
    !pages.length ||
    pages.some(
      (page) => !safeSegment(page) || !page.toLowerCase().endsWith(".png"),
    )
  ) {
    throw new DataError(
      "The texture atlas references an unsupported or unsafe image path.",
    );
  }
  return [...new Set(pages)];
}

export async function downloadAsset(
  file: AssetFile,
  revision: string,
  directory: "spineassets/character" | "skills" = "spineassets/character",
): Promise<Buffer> {
  const bytes = await remoteBytes(
    `https://raw.githubusercontent.com/Aceship/Arknight-Images/${revision}/${directory}/${encodePath(file.path)}`,
    file.size,
  );
  const sha = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  if (bytes.length !== file.size || sha !== file.sha)
    throw new DataError(
      "A downloaded file failed its integrity check. Retry the import.",
    );
  return bytes;
}
