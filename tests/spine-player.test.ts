import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import {
  decodeSkeleton,
  runtimeFamily,
  spineVersion,
} from "../public/spine-player.js";

function encodedString(value: string) {
  const bytes = new TextEncoder().encode(value);
  let length = bytes.length + 1;
  const prefix = [];
  do {
    const byte = length & 127;
    length = Math.floor(length / 128);
    prefix.push(byte | (length ? 128 : 0));
  } while (length);
  return [...prefix, ...bytes];
}

test("Spine version selection reads binary and JSON export headers", () => {
  for (const version of ["3.5.51", "3.6.53", "3.7.94", "3.8.99"]) {
    const binary = new Uint8Array([
      ...encodedString("hash"),
      ...encodedString(version),
    ]);
    assert.equal(spineVersion(binary), version);
    assert.equal(spineVersion({ skeleton: { spine: version } }), version);
    assert.equal(runtimeFamily(version), version.slice(0, 3));
  }
  const newer = new Uint8Array([
    ...Array(8).fill(255),
    ...encodedString("4.2.43"),
  ]);
  assert.equal(spineVersion(newer), "4.2.43");
  for (const version of ["4.2.43", "3.4.02", "3.8.99-extra", "", undefined])
    assert.throws(() => runtimeFamily(version), /not supported/);
});

test("malformed and oversized skeleton headers fail before runtime loading", () => {
  for (const input of [[], [128], [255, 255, 255, 255, 127], [10, 65], [1, 1]])
    assert.throws(() => spineVersion(new Uint8Array(input)), /header/);
  assert.throws(() => spineVersion({}), /no Spine export version/);
});

for (const family of ["3.7", "3.8"]) {
  test(`${family}: the native decoder produces an animated skeleton`, () => {
    const runtime = vm.runInNewContext(
      `${readFileSync(new URL(`../public/vendor/spine/${family}/spine-webgl.js`, import.meta.url), "utf8")}\nspine;`,
      {
        window: {},
        document: {},
        WebGLRenderingContext: { POINTS: 0, LINES: 1, TRIANGLES: 4 },
      },
    );
    const source = {
      skeleton: { spine: `${family}.99` },
      bones: [{ name: "root" }],
      animations: {
        Idle: {
          bones: {
            root: {
              rotate: [
                { time: 0, angle: 0 },
                { time: 1, angle: 60 },
              ],
            },
          },
        },
      },
    };
    const data = decodeSkeleton(runtime, source, {}, source.skeleton.spine);
    const skeleton = new runtime.Skeleton(data);
    const state = new runtime.AnimationState(
      new runtime.AnimationStateData(data),
    );
    state.setAnimation(0, "Idle", true);
    state.update(0.5);
    state.apply(skeleton);
    skeleton.updateWorldTransform();
    assert.equal(data.animations[0].duration, 1);
    assert.ok(Math.abs(skeleton.bones[0].rotation - 30) < 0.01);
  });
}
