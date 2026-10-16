import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  atlasPages,
  DataError,
  downloadAsset,
  encodePath,
  safeSegment,
} from "./aceship.ts";
import type {
  AssetFile,
  Catalog,
  ImportManifest,
  ImportResponse,
  Operator,
  OperatorSkin,
} from "./data-types.ts";

export function selectBundle(
  catalog: Catalog,
  operatorId: unknown,
  skinId: unknown,
): { operator: Operator; skin: OperatorSkin } {
  if (
    typeof operatorId !== "string" ||
    typeof skinId !== "string" ||
    !safeSegment(operatorId) ||
    !safeSegment(skinId)
  ) {
    throw new DataError("Choose an operator and outfit from the catalog.", 400);
  }
  const operator = catalog.operators.find(
    (candidate) => candidate.id === operatorId,
  );
  const skin = operator?.skins.find((candidate) => candidate.id === skinId);
  if (!operator || !skin)
    throw new DataError(
      "That outfit has no available sprite bundle. Refresh the catalog and select again.",
      400,
    );
  return { operator, skin };
}

async function savedBundle(
  target: string,
  operator: Operator,
  skin: OperatorSkin,
): Promise<ImportManifest | null> {
  let exists = false;
  try {
    await lstat(target);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (exists) {
    try {
      const manifest: ImportManifest = JSON.parse(
        await readFile(path.join(target, "manifest.json"), "utf8"),
      );
      if (
        ![1, 2, 3].includes(manifest.version) ||
        manifest.operator.id !== operator.id ||
        manifest.skin.id !== skin.id ||
        !manifest.files.length
      )
        throw new Error("Invalid manifest");
      // An import is reusable only when every saved file still matches its source.
      for (const file of manifest.files) {
        if (!file.path.split("/").every(safeSegment))
          throw new Error("Invalid saved file path");
        const bytes = await readFile(path.join(target, file.path));
        const sha = createHash("sha1")
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest("hex");
        if (bytes.length !== file.bytes || sha !== file.sha)
          throw new Error("Saved file is missing or changed");
      }
      return manifest;
    } catch {
      throw new DataError(
        "The existing import is incomplete or changed. Move its folder out of public/operators, then download again.",
        409,
      );
    }
  }
  return null;
}

export async function importOperator(
  catalog: Catalog,
  operatorId: unknown,
  skinId: unknown,
): Promise<ImportResponse> {
  const { operator, skin } = selectBundle(catalog, operatorId, skinId);
  const relative = `${operator.id}/${skin.id}`;
  const target = path.join(process.cwd(), "public/operators", relative);
  const manifestUrl = `/api/data/files/${encodePath(relative)}/manifest.json`;
  const cacheRoot = path.join(process.cwd(), ".cache/aceship");
  await mkdir(path.join(cacheRoot, "locks"), { recursive: true });
  const lock = path.join(cacheRoot, "locks", `${operator.id}--${skin.id}`);
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new DataError(
        "This outfit is already being downloaded. Wait for it to finish, then load it again.",
        409,
      );
    throw error;
  }
  const stage = path.join(cacheRoot, "imports", randomUUID());
  try {
    const saved = await savedBundle(target, operator, skin);
    if (saved?.version === 3 && saved.skills)
      return { manifest: saved, manifestUrl, cached: true };
    await mkdir(stage, { recursive: true });
    const manifest: ImportManifest = saved
      ? {
          ...saved,
          version: 3,
          files: [...saved.files],
          skills: [],
          skillRevision: catalog.revision,
        }
      : {
          version: 3,
          operator: { id: operator.id, name: operator.name },
          skin: { id: skin.id, name: skin.name },
          importedAt: new Date().toISOString(),
          revision: catalog.revision,
          source: `https://github.com/Aceship/Arknight-Images/tree/${catalog.revision}/spineassets/character/${operator.id}`,
          directory: `public/operators/${relative}`,
          views: [],
          files: [],
          skills: [],
          skillRevision: catalog.revision,
        };
    let totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
    async function save(
      file: AssetFile,
      destination: string,
      content?: Buffer,
    ): Promise<void> {
      const existing = manifest.files.find(
        (candidate) => candidate.path === destination,
      );
      if (existing) {
        if (existing.sha !== file.sha)
          throw new DataError(
            "A saved skill icon differs from the source. Move the outfit folder aside before reimporting.",
            409,
          );
        return;
      }
      totalBytes += file.size;
      if (totalBytes > 100 * 1024 * 1024)
        throw new DataError("This outfit exceeds the 100 MB import limit.");
      const bytes = content ?? (await downloadAsset(file, catalog.revision));
      await mkdir(path.dirname(path.join(stage, destination)), {
        recursive: true,
      });
      await writeFile(path.join(stage, destination), bytes, { flag: "wx" });
      manifest.files.push({
        path: destination,
        bytes: bytes.length,
        sha: file.sha,
      });
    }
    // Keep each outfit's complete front/back/base bundle together; never fetch other skins.
    for (const view of saved ? [] : skin.views) {
      const atlas = await downloadAsset(view.atlas, catalog.revision);
      const sourceDirectory = path.posix.dirname(view.atlas.path);
      const textures = atlasPages(atlas.toString("utf8")).map((page) => {
        const file = catalog.files[`${sourceDirectory}/${page}`];
        if (!file)
          throw new DataError(
            `A texture referenced by the ${view.name} atlas is missing from Aceship's inventory.`,
          );
        return file;
      });
      const localPath = (file: AssetFile) =>
        `${view.name}/${path.posix.basename(file.path)}`;
      await save(view.atlas, localPath(view.atlas), atlas);
      await save(view.skeleton, localPath(view.skeleton));
      for (const file of textures) await save(file, localPath(file));
      manifest.views.push({
        name: view.name,
        skeleton: localPath(view.skeleton),
        atlas: localPath(view.atlas),
        textures: textures.map(localPath),
      });
    }
    for (const skill of operator.skills) {
      const icon = skill.icon ? `skills/${skill.icon.path}` : null;
      if (
        skill.icon &&
        icon &&
        !manifest.files.some(
          (file) => file.path === icon && file.sha === skill.icon!.sha,
        )
      )
        await save(
          skill.icon,
          icon,
          await downloadAsset(skill.icon, catalog.revision, "skills"),
        );
      manifest.skills!.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        timing: skill.timing,
        levelLabel: skill.levelLabel,
        activation: skill.activation,
        icon,
        preview: skill.preview,
      });
    }
    await writeFile(
      path.join(stage, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    if (saved) {
      // Upgrade earlier imports additively. A failed upgrade leaves their sprites usable.
      if (manifest.skills!.some((skill) => skill.icon)) {
        let existingIcons = false;
        try {
          existingIcons = (
            await lstat(path.join(target, "skills"))
          ).isDirectory();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (existingIcons) {
          for (const file of manifest.files.filter((file) =>
            file.path.startsWith("skills/"),
          )) {
            const bytes = await readFile(path.join(target, file.path));
            const sha = createHash("sha1")
              .update(`blob ${bytes.length}\0`)
              .update(bytes)
              .digest("hex");
            if (sha !== file.sha)
              throw new DataError(
                "The existing skill icon folder has changed. Move it aside before retrying.",
                409,
              );
          }
        } else
          await rename(path.join(stage, "skills"), path.join(target, "skills"));
      }
      await rename(
        path.join(stage, "manifest.json"),
        path.join(target, "manifest.json"),
      );
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      // Publish the entire bundle at once, only after every source file is verified.
      await rename(stage, target);
    }
    return { manifest, manifestUrl, cached: false };
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
