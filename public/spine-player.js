const RUNTIMES = {
  3.5: "/vendor/aceship/spine-widget.js",
  3.6: "/vendor/aceship/spine-widget.js",
  3.7: "/vendor/spine/3.7/spine-webgl.js",
  3.8: "/vendor/spine/3.8/spine-webgl.js",
};

export function runtimeFamily(version) {
  const family =
    typeof version === "string"
      ? version.match(/^(\d+\.\d+)(?:\.\d+)?$/)?.[1]
      : null;
  if (!family || !RUNTIMES[family])
    throw new Error(
      `Spine ${version || "version unknown"} is not supported by this player. Supported export families: 3.5, 3.6, 3.7, 3.8. The original files remain saved.`,
    );
  return family;
}

export function spineVersion(source) {
  if (!(source instanceof Uint8Array)) {
    const version = source?.skeleton?.spine;
    if (typeof version !== "string")
      throw new Error("The skeleton JSON has no Spine export version.");
    return version;
  }
  function stringAt(start) {
    let offset = start,
      length = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (offset >= source.length)
        throw new Error("Incomplete skeleton header.");
      const byte = source[offset++];
      length += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) {
        const count = Math.max(0, length - 1);
        if (count > 256 || offset + count > source.length)
          throw new Error("Invalid skeleton header.");
        return {
          text: new TextDecoder("utf-8", { fatal: true }).decode(
            source.subarray(offset, offset + count),
          ),
          next: offset + count,
        };
      }
    }
    throw new Error("Invalid skeleton header.");
  }
  // 3.x has a string hash followed by the version. Newer exports use an 8-byte
  // hash; recognize their version too so the error names the unsupported family.
  for (const start of [null, 8]) {
    try {
      const version = stringAt(start === null ? stringAt(0).next : start).text;
      if (/^\d+\.\d+(?:\.\d+)?$/.test(version)) return version;
    } catch {
      /* Try the other documented header layout, never scan arbitrary data. */
    }
  }
  throw new Error(
    "The skeleton has an invalid or incomplete Spine version header.",
  );
}

async function script(url) {
  await new Promise((resolve, reject) => {
    const element = document.createElement("script");
    const timeout = setTimeout(() => {
      element.remove();
      reject(
        new Error(
          "The local Spine runtime took too long to load. Reload the preview.",
        ),
      );
    }, 30_000);
    element.src = url;
    element.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    element.onerror = () => {
      clearTimeout(timeout);
      reject(
        new Error(
          "The local Spine runtime could not be loaded. Reload the preview.",
        ),
      );
    };
    document.head.append(element);
  });
}

export function decodeSkeleton(runtime, source, atlas, version, LegacyBinary) {
  const family = runtimeFamily(version);
  const attachments = new runtime.AtlasAttachmentLoader(atlas);
  if (source instanceof Uint8Array && ["3.5", "3.6"].includes(family)) {
    const decoder = new LegacyBinary();
    decoder.json = {};
    decoder.data = source;
    decoder.initJson();
    return new runtime.SkeletonJson(attachments).readSkeletonData(decoder.json);
  }
  return source instanceof Uint8Array
    ? new runtime.SkeletonBinary(attachments).readSkeletonData(source)
    : new runtime.SkeletonJson(attachments).readSkeletonData(source);
}

async function localFile(url, json = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok)
    throw new Error(
      `A saved sprite file could not be loaded (HTTP ${response.status}).`,
    );
  return json ? response.json() : new Uint8Array(await response.arrayBuffer());
}

function fitCamera(runtime, skeleton, animation) {
  const sampler = new runtime.AnimationState(
    new runtime.AnimationStateData(skeleton.data),
  );
  const entry = sampler.setAnimation(0, animation, false);
  const offset = new runtime.Vector2(),
    size = new runtime.Vector2();
  let left = Infinity,
    bottom = Infinity,
    right = -Infinity,
    top = -Infinity;
  for (let frame = 0; frame <= 30; frame++) {
    skeleton.setToSetupPose();
    entry.trackTime = (entry.animation.duration * frame) / 30;
    sampler.apply(skeleton);
    skeleton.updateWorldTransform();
    skeleton.getBounds(offset, size);
    if (
      !Number.isFinite(offset.x + offset.y + size.x + size.y) ||
      size.x <= 0 ||
      size.y <= 0
    )
      continue;
    left = Math.min(left, offset.x);
    bottom = Math.min(bottom, offset.y);
    right = Math.max(right, offset.x + size.x);
    top = Math.max(top, offset.y + size.y);
  }
  skeleton.setToSetupPose();
  skeleton.updateWorldTransform();
  return Number.isFinite(left)
    ? {
        x: (left + right) / 2,
        y: (bottom + top) / 2,
        width: right - left,
        height: top - bottom,
      }
    : { x: 0, y: 100, width: 300, height: 300 };
}

export async function createSpinePlayer(stage, files, onFrame, onError) {
  const source = await localFile(
    files.skeleton,
    files.skeleton.endsWith(".json"),
  );
  const version = spineVersion(source);
  const family = runtimeFamily(version);
  await script(RUNTIMES[family]);
  const legacy = ["3.5", "3.6"].includes(family);
  if (legacy) await script("/vendor/aceship/spine-skeleton-binary.js");
  // Only one runtime is loaded in this iframe, so its global namespace stays isolated.
  const runtime = window.spine;
  const canvas = document.createElement("canvas");
  canvas.style.width = canvas.style.height = "100%";
  stage.append(canvas);
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) {
    canvas.remove();
    throw new Error(
      "WebGL is unavailable. Enable browser graphics acceleration to preview animations.",
    );
  }
  const context = legacy
    ? gl
    : new runtime.webgl.ManagedWebGLRenderingContext(gl);
  const textures = new Map();
  let shader, batcher, atlas;
  try {
    const atlasBytes = await localFile(files.atlas);
    const images = await Promise.all(
      files.textures.map(async (texture) => {
        const image = new Image();
        image.src = texture.url;
        try {
          await image.decode();
        } catch {
          throw new Error(
            `The saved texture ${texture.name} could not be loaded.`,
          );
        }
        return { name: texture.name, image };
      }),
    );
    for (const { name, image } of images)
      textures.set(name, new runtime.webgl.GLTexture(context, image));
    atlas = new runtime.TextureAtlas(
      new TextDecoder().decode(atlasBytes),
      (name) => {
        const texture = textures.get(name);
        if (!texture)
          throw new Error(`The atlas references an unsaved texture: ${name}`);
        return texture;
      },
    );
    const data = decodeSkeleton(
      runtime,
      source,
      atlas,
      version,
      window.SkeletonBinary,
    );
    if (!data.animations.length)
      throw new Error("This skeleton has no animations.");
    const skeleton = new runtime.Skeleton(data);
    if (data.skins.length)
      skeleton.setSkinByName(
        data.skins.find((skin) => skin.name === "default")?.name ??
          data.skins[0].name,
      );
    const initial =
      ["Idle", "Relax", "Move"].find((name) =>
        data.animations.some((clip) => clip.name === name),
      ) ?? data.animations[0].name;
    const camera = fitCamera(runtime, skeleton, initial);
    const state = new runtime.AnimationState(
      new runtime.AnimationStateData(data),
    );
    state.setAnimation(0, initial, true);
    shader = legacy
      ? runtime.webgl.Shader.newColoredTextured(context)
      : runtime.webgl.Shader.newTwoColoredTextured(context);
    batcher = new runtime.webgl.PolygonBatcher(context);
    const renderer = new runtime.webgl.SkeletonRenderer(context);
    renderer.premultipliedAlpha = true;
    const matrix = new runtime.webgl.Matrix4();
    let animationFrame = null,
      disposed = false,
      lastTime = 0;
    const player = {
      skeleton,
      state,
      initial,
      version,
      zoom: 1,
      setAnimation(name) {
        skeleton.setToSetupPose();
        state.setAnimation(0, name, true);
      },
      play() {
        if (disposed || animationFrame !== null) return;
        lastTime = performance.now();
        animationFrame = requestAnimationFrame(tick);
      },
      pause() {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        animationFrame = null;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        this.pause();
        shader.dispose();
        batcher.dispose();
        for (const texture of textures.values()) texture.dispose();
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        canvas.remove();
      },
    };
    function tick(time) {
      animationFrame = null;
      if (disposed) return;
      try {
        const delta = Math.min(0.1, Math.max(0, (time - lastTime) / 1000));
        lastTime = time;
        const width = Math.max(
          1,
          Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1, 2)),
        );
        const height = Math.max(
          1,
          Math.round(canvas.clientHeight * Math.min(devicePixelRatio || 1, 2)),
        );
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        state.update(delta);
        state.apply(skeleton);
        skeleton.updateWorldTransform();
        const scale =
          (Math.max(camera.width / width, camera.height / height) * 1.6) /
          player.zoom;
        matrix.ortho2d(
          camera.x - (width * scale) / 2,
          camera.y - (height * scale) / 2,
          width * scale,
          height * scale,
        );
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        shader.bind();
        shader.setUniformi(runtime.webgl.Shader.SAMPLER, 0);
        shader.setUniform4x4f(runtime.webgl.Shader.MVP_MATRIX, matrix.values);
        batcher.begin(shader);
        renderer.draw(batcher, skeleton);
        batcher.end();
        shader.unbind();
        onFrame();
        animationFrame = requestAnimationFrame(tick);
      } catch (error) {
        player.dispose();
        onError(error);
      }
    }
    return player;
  } catch (error) {
    shader?.dispose();
    batcher?.dispose();
    for (const texture of textures.values()) texture.dispose();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
    throw new Error(
      `Could not load Spine ${version}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
