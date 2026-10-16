import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  atlasPages,
  buildOperators,
  DataError,
  safeSegment,
  type TreeEntry,
} from "../lib/aceship.ts";
import { importOperator, selectBundle } from "../lib/import-operator.ts";
import type { Catalog } from "../lib/data-types.ts";

const revision = "a".repeat(40);
function entries(paths: string[]): TreeEntry[] {
  return paths.map((filename) => ({
    path: filename,
    type: "blob",
    sha: "b".repeat(40),
    size: 30,
  }));
}
function bundle(stem: string, view = "front"): string[] {
  return ["skel", "atlas", "png"].map(
    (extension) => `char_002_amiya/${view}/${stem}.${extension}`,
  );
}

test("inventory filters missing bundles, joins outfit names, and merges base/front views", () => {
  const result = buildOperators(
    entries([
      ...bundle("char_002_amiya"),
      ...bundle("char_002_amiya_winter_1"),
      ...bundle("build_char_002_amiya_winter_1", "build"),
      "char_002_amiya/front/char_002_amiya_missing.skel",
      "char_002_amiya/front/char_002_amiya_missing.atlas",
      "char_002_amiya/front/../../escape.skel",
    ]),
    { char_002_amiya: { name: "Amiya" } },
    {
      winter: {
        charId: "char_002_amiya",
        battleSkin: { skinOrPrefabId: "char_002_amiya_winter#1" },
        displaySkin: { skinName: "Newsgirl" },
      },
      unavailable: {
        charId: "char_002_amiya",
        battleSkin: { skinOrPrefabId: "char_002_amiya_not_available" },
        displaySkin: { skinName: "Not uploaded" },
      },
    },
  );
  assert.equal(result.operators.length, 1);
  assert.equal(result.operators[0].name, "Amiya");
  assert.deepEqual(
    result.operators[0].skins.map((skin) => skin.name),
    ["Default outfit", "Newsgirl"],
  );
  assert.deepEqual(
    result.operators[0].skins[1].views.map((view) => view.name),
    ["front", "build"],
  );
  assert.equal(
    result.files["char_002_amiya/front/../../escape.skel"],
    undefined,
  );
});

test("atlas pages include every texture and reject traversal and remote URLs", () => {
  assert.deepEqual(
    atlasPages(
      "first.png\r\nsize: 512,512\r\nregion\r\n  rotate: false\r\n\r\nsecond.png\r\nsize: 256,256\r\n",
    ),
    ["first.png", "second.png"],
  );
  for (const input of [
    "../escape.png\nsize: 1,1",
    "/tmp/a.png",
    "https://example.com/a.png",
    "",
    "image.svg",
  ]) {
    assert.throws(() => atlasPages(input), DataError);
  }
});

test("operator forms with the same name are distinguished by class", () => {
  const files = [
    ...bundle("char_002_amiya"),
    ...bundle("char_1001_amiya2").map((filename) =>
      filename.replace("char_002_amiya/", "char_1001_amiya2/"),
    ),
  ];
  const { operators } = buildOperators(
    entries(files),
    {
      char_002_amiya: { name: "Amiya", profession: "CASTER" },
      char_1001_amiya2: { name: "Amiya", profession: "WARRIOR" },
    },
    {},
  );
  assert.deepEqual(
    operators.map((operator) => operator.name),
    ["Amiya (Caster)", "Amiya (Guard)"],
  );
});

test("only catalog selections can become download paths", () => {
  const catalog: Catalog = {
    version: 3,
    revision,
    fetchedAt: new Date().toISOString(),
    ...buildOperators(entries(bundle("char_002_amiya")), {}, {}),
  };
  assert.equal(
    selectBundle(catalog, "char_002_amiya", "char_002_amiya").operator.id,
    "char_002_amiya",
  );
  for (const skin of ["../outside", "char_002_amiya_not_uploaded", null, 123]) {
    assert.throws(
      () => selectBundle(catalog, "char_002_amiya", skin),
      DataError,
    );
  }
  assert.equal(safeSegment(".."), false);
  assert.equal(safeSegment("a/b"), false);
  assert.equal(safeSegment("a\\b"), false);
  assert.equal(safeSegment("char_001_test#1"), true);
});

test("imports all atlas pages atomically, reuses verified files, and preserves changed imports", async (context) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "arknights-import-test-"),
  );
  const originalDirectory = process.cwd();
  process.chdir(directory);
  try {
    const source = new Map<string, Buffer>([
      [
        "char_002_amiya/front/char_002_amiya.skel",
        Buffer.from("test skeleton"),
      ],
      [
        "char_002_amiya/front/char_002_amiya.atlas",
        Buffer.from("char_002_amiya.png\nsize: 1,1\n\nsecond.png\nsize: 1,1\n"),
      ],
      ["char_002_amiya/front/char_002_amiya.png", Buffer.from("first texture")],
      ["char_002_amiya/front/second.png", Buffer.from("second texture")],
    ]);
    const inventory = [...source].map(([filename, bytes]) => ({
      path: filename,
      type: "blob",
      size: bytes.length,
      sha: createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex"),
    }));
    const catalog: Catalog = {
      version: 3,
      revision,
      fetchedAt: new Date().toISOString(),
      ...buildOperators(inventory, {}, {}),
    };
    let calls = 0;
    context.mock.method(globalThis, "fetch", async (url: string) => {
      calls++;
      const filename = decodeURIComponent(
        url.split("/spineassets/character/")[1] ?? url.split("/skills/")[1],
      );
      assert.ok(url.includes(revision));
      assert.ok(source.has(filename));
      return new Response(new Uint8Array(source.get(filename)!));
    });
    const result = await importOperator(
      catalog,
      "char_002_amiya",
      "char_002_amiya",
    );
    assert.equal(result.cached, false);
    assert.equal(result.manifest.files.length, 4);
    assert.equal(result.manifest.views[0].textures.length, 2);
    const target = path.join(directory, result.manifest.directory);
    assert.equal(
      JSON.parse(await readFile(path.join(target, "manifest.json"), "utf8"))
        .revision,
      revision,
    );
    assert.deepEqual(
      await readdir(path.join(directory, ".cache/aceship/imports")),
      [],
    );
    const reused = await importOperator(
      catalog,
      "char_002_amiya",
      "char_002_amiya",
    );
    assert.equal(reused.cached, true);
    assert.equal(calls, 4);
    const iconBytes = Buffer.from("skill icon");
    const icon = {
      path: "skill_icon_fixture.png",
      size: iconBytes.length,
      sha: createHash("sha1")
        .update(`blob ${iconBytes.length}\0`)
        .update(iconBytes)
        .digest("hex"),
    };
    source.set(icon.path, iconBytes);
    catalog.operators[0].skills = [
      { id: "fixture", name: "Fixture skill", icon },
    ];
    await writeFile(
      path.join(target, "manifest.json"),
      JSON.stringify({ ...result.manifest, version: 1, skills: undefined }),
    );
    const upgraded = await importOperator(
      catalog,
      "char_002_amiya",
      "char_002_amiya",
    );
    assert.equal(upgraded.manifest.version, 3);
    assert.equal(
      upgraded.manifest.skills![0].icon,
      "skills/skill_icon_fixture.png",
    );
    assert.equal(
      calls,
      5,
      "upgrade downloads the icon without downloading sprites again",
    );
    await writeFile(
      path.join(target, "manifest.json"),
      JSON.stringify({ ...upgraded.manifest, version: 2 }),
    );
    catalog.operators[0].skills[0].description = "An instant skill.";
    catalog.operators[0].skills[0].timing = { kind: "instant" };
    const metadataUpgrade = await importOperator(
      catalog,
      "char_002_amiya",
      "char_002_amiya",
    );
    assert.equal(
      metadataUpgrade.manifest.skills![0].description,
      "An instant skill.",
    );
    assert.equal(calls, 5, "description upgrades reuse both sprites and icons");
    assert.deepEqual(
      await readFile(path.join(target, "front/char_002_amiya.skel")),
      source.get("char_002_amiya/front/char_002_amiya.skel"),
    );
    await writeFile(path.join(target, "front/char_002_amiya.png"), "changed");
    await assert.rejects(
      importOperator(catalog, "char_002_amiya", "char_002_amiya"),
      /incomplete or changed/,
    );
    assert.equal(
      await readFile(path.join(target, "front/char_002_amiya.png"), "utf8"),
      "changed",
    );
    await rm(path.join(target, "manifest.json"));
    await assert.rejects(
      importOperator(catalog, "char_002_amiya", "char_002_amiya"),
      /incomplete or changed/,
    );
  } finally {
    process.chdir(originalDirectory);
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed integrity check publishes no bundle and releases its lock", async (context) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "arknights-failed-import-"),
  );
  const originalDirectory = process.cwd();
  process.chdir(directory);
  try {
    const catalog: Catalog = {
      version: 3,
      revision,
      fetchedAt: new Date().toISOString(),
      ...buildOperators(entries(bundle("char_002_amiya")), {}, {}),
    };
    context.mock.method(
      globalThis,
      "fetch",
      async () => new Response("wrong bytes"),
    );
    await assert.rejects(
      importOperator(catalog, "char_002_amiya", "char_002_amiya"),
      /integrity/,
    );
    await assert.rejects(
      readFile(
        path.join(
          directory,
          "public/operators/char_002_amiya/char_002_amiya/manifest.json",
        ),
      ),
    );
    assert.deepEqual(
      await readdir(path.join(directory, ".cache/aceship/locks")),
      [],
    );
    assert.deepEqual(
      await readdir(path.join(directory, ".cache/aceship/imports")),
      [],
    );
  } finally {
    process.chdir(originalDirectory);
    await rm(directory, { recursive: true, force: true });
  }
});
