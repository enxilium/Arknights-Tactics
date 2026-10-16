"use strict";

import { createSpinePlayer } from "/spine-player.js";

import {
  skillSequences,
  queueSkill,
  endSkill,
  skillProgress,
} from "/skill-sequences.js";

const statusElement = document.getElementById("status");
const stage = document.getElementById("stage");
const animationSelect = document.getElementById("animation");
const playButton = document.getElementById("play");
let widget;
let mirrored = false;
let paused = false;
let skills = [];
let plans = [];
let activeSkill = -1;
let playback = null;

function showProgress() {
  const container = document.getElementById("skill-progress");
  const endButton = document.getElementById("end-skill");
  container.hidden = !playback;
  endButton.hidden = !playback?.plan.sustained;
  if (!playback) return;
  const progress = skillProgress(widget.state, playback);
  document.getElementById("progress-label").textContent = progress.label;
  const bar = document.getElementById("remaining");
  bar.hidden = !(progress.maximum > 0);
  if (!bar.hidden) {
    bar.max = progress.maximum;
    bar.value = progress.remaining;
    bar.setAttribute(
      "aria-label",
      playback.plan.timing.kind === "ammo"
        ? "Remaining preview ammunition"
        : "Remaining skill seconds",
    );
  }
  endButton.disabled = !progress.canEnd;
  endButton.textContent =
    playback.endingRequested && !progress.complete ? "Ending…" : "End skill";
}

function fail(error) {
  statusElement.textContent =
    error instanceof Error ? error.message : String(error);
  statusElement.className = "error";
  statusElement.setAttribute("role", "alert");
  if (widget) widget.pause();
}

window.addEventListener("error", (event) => fail(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => fail(event.reason));

function assetUrl(base, filename) {
  return base + filename.split("/").map(encodeURIComponent).join("/");
}

async function localFile(url, asJson = false) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok)
    throw new Error(
      `A saved sprite file could not be loaded (HTTP ${response.status}). Download the bundle again.`,
    );
  return asJson ? response.json() : response.arrayBuffer();
}

function updateInfo() {
  if (activeSkill >= 0) {
    const progress = playback ? skillProgress(widget.state, playback) : null;
    document.getElementById("clip-info").textContent = progress
      ? `S${activeSkill + 1} · ${progress.phase} · ${progress.clip} · local files`
      : "No distinct activation animation in this view";
    showProgress();
    return;
  }
  const animation = widget.skeleton.data.animations.find(
    (clip) => clip.name === animationSelect.value,
  );
  document.getElementById("clip-info").textContent =
    `${widget.skeleton.data.animations.length} clips · ${animation.duration.toFixed(2)}s · Spine ${widget.skeleton.data.version || "legacy"} · local files`;
}

function setAnimation() {
  if (animationSelect.value.startsWith("skill:")) {
    playSkillPreview(Number(animationSelect.value.slice(6)));
    return;
  }
  activeSkill = -1;
  playback = null;
  showProgress();
  for (const button of document.querySelectorAll(".skill-button"))
    button.setAttribute("aria-pressed", "false");
  widget.state.clearTracks();
  widget.setAnimation(animationSelect.value);
  widget.state.apply(widget.skeleton);
  widget.skeleton.updateWorldTransform();
  updateInfo();
}

function playSkillPreview(index) {
  const plan = plans[index];
  activeSkill = index;
  playback = null;
  parent.postMessage(
    { type: "skill-selected", id: skills[index].id },
    location.origin,
  );
  for (const [position, button] of [
    ...document.querySelectorAll(".skill-button"),
  ].entries())
    button.setAttribute("aria-pressed", String(position === index));
  paused = false;
  playButton.textContent = "Pause";
  widget.state.timeScale = Number(document.getElementById("speed").value);
  widget.skeleton.setToSetupPose();
  if (plan) {
    animationSelect.value = `skill:${index}`;
    playback = queueSkill(widget.state, plan);
  } else {
    widget.state.clearTracks();
    const idle = ["Idle", "Relax", "Default"].find((name) =>
      widget.skeleton.data.animations.some((clip) => clip.name === name),
    );
    if (idle) {
      widget.setAnimation(idle);
      animationSelect.value = idle;
    }
  }
  updateInfo();
}

function setupSkills(manifest, base, player) {
  skills = manifest.skills ?? [];
  plans = skillSequences(player.skeleton.data.animations, skills);
  const fullGroup = document.createElement("optgroup");
  fullGroup.label = "Full skills";
  for (const [index, skill] of skills.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skill-button";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute(
      "aria-label",
      `${plans[index] ? "Play full" : "View"} S${index + 1}: ${skill.name}`,
    );
    button.title = plans[index]
      ? `${skill.name} · ${plans[index].steps.map((step) => step.name + (step.repeat > 1 ? ` ×${step.repeat}` : "")).join(" → ")}`
      : `${skill.name} · No distinct skill animation in this view`;
    if (skill.icon) {
      const image = document.createElement("img");
      image.src = assetUrl(base, skill.icon);
      image.alt = "";
      image.width = 44;
      image.height = 44;
      button.append(image);
    }
    const name = document.createElement("span");
    name.textContent = `S${index + 1} · ${skill.name}`;
    button.append(name);
    if (!plans[index]) {
      const unavailable = document.createElement("small");
      unavailable.textContent = "No distinct animation";
      button.append(unavailable);
    }
    button.addEventListener("click", () => playSkillPreview(index));
    document.getElementById("skill-buttons").append(button);
    if (plans[index]) {
      const option = document.createElement("option");
      option.value = `skill:${index}`;
      option.textContent = `S${index + 1} · ${skill.name} (full)`;
      fullGroup.append(option);
    }
  }
  if (fullGroup.children.length) animationSelect.append(fullGroup);
  if (skills.length) {
    document.getElementById("skills").hidden = false;
    document.body.classList.add("has-skills");
  }
}

async function load() {
  const params = new URLSearchParams(location.search);
  const manifestPath = params.get("manifest") || "";
  if (
    !/^\/api\/data\/files\/char_[A-Za-z0-9_]+\/[A-Za-z0-9_@#.+%\[\]-]+\/manifest\.json$/.test(
      manifestPath,
    )
  ) {
    throw new Error("Choose and download an outfit on the data page first.");
  }
  const manifest = await localFile(manifestPath, true);
  const view =
    manifest.views.find((candidate) => candidate.name === params.get("view")) ||
    manifest.views[0];
  if (!view) throw new Error("This bundle contains no sprite views.");
  const base = manifestPath.slice(0, -"manifest.json".length);
  widget = await createSpinePlayer(
    stage,
    {
      skeleton: assetUrl(base, view.skeleton),
      atlas: assetUrl(base, view.atlas),
      textures: view.textures.map((filename) => ({
        name: filename.split("/").at(-1),
        url: assetUrl(base, filename),
      })),
    },
    () => {
      if (activeSkill >= 0) updateInfo();
    },
    fail,
  );
  setupSkills(manifest, base, widget);
  const rawGroup = document.createElement("optgroup");
  rawGroup.label = "Individual clips";
  for (const animation of widget.skeleton.data.animations) {
    const option = document.createElement("option");
    option.value = animation.name;
    option.textContent = animation.name;
    rawGroup.append(option);
  }
  animationSelect.append(rawGroup);
  animationSelect.value = widget.initial;
  document.getElementById("controls").hidden = false;
  statusElement.textContent = `${manifest.operator.name} / ${manifest.skin.name} · Spine ${widget.version}`;
  statusElement.title = statusElement.textContent;
  updateInfo();
  widget.play();
}

animationSelect.addEventListener("change", setAnimation);
document.getElementById("speed").addEventListener("change", (event) => {
  widget.state.timeScale = paused ? 0 : Number(event.target.value);
});
playButton.addEventListener("click", () => {
  // Keep one render loop alive; timeScale freezes animation without spawning extra loops.
  paused = !paused;
  widget.state.timeScale = paused
    ? 0
    : Number(document.getElementById("speed").value);
  playButton.textContent = paused ? "Play" : "Pause";
});
document.getElementById("restart").addEventListener("click", setAnimation);
document.getElementById("zoom").addEventListener("input", (event) => {
  if (widget) widget.zoom = Number(event.target.value);
});
window.addEventListener("pagehide", () => widget?.dispose(), { once: true });
document.getElementById("end-skill").addEventListener("click", () => {
  if (playback) endSkill(widget.state, playback);
});
document.getElementById("mirror").addEventListener("click", (event) => {
  mirrored = !mirrored;
  stage.style.transform = mirrored ? "scaleX(-1)" : "";
  event.target.setAttribute("aria-pressed", String(mirrored));
});
document
  .getElementById("controls")
  .addEventListener("submit", (event) => event.preventDefault());
load().catch(fail);
