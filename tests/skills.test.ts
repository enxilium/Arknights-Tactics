import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { addOperatorSkills, buildOperators } from "../lib/aceship.ts";
import {
  skillDescription,
  skillInfo,
  skillTiming,
} from "../lib/skill-metadata.ts";
import {
  skillSequences,
  queueSkill,
  endSkill,
  skillProgress,
} from "../public/skill-sequences.js";

const clips = [
  "Idle",
  "Skill_Begin",
  "Skill_Idle",
  "Skill_Loop",
  "Skill_End",
  "Skill_Daze",
  "Skill_Loop_Down",
  "Skill_1_Begin",
  "Skill_1_Loop",
  "Skill_1_End",
  "Skill_2_Begin",
  "Skill_2_Loop",
  "Skill_2_End",
].map((name) => ({ name, duration: /Begin|End/.test(name) ? 0.1 : 1 }));
const skills = ["First", "Second", "Third"].map((name) => ({
  name,
  timing: { kind: "timed", seconds: 3 },
}));

test("skill groups keep Aceship's mapping without inserting skill idle into sustained sequences", () => {
  const plans = skillSequences(clips, skills);
  assert.deepEqual(
    plans[0]!.steps.map((step: { name: string }) => step.name),
    ["Skill_Begin", "Skill_Loop", "Skill_End"],
  );
  assert.deepEqual(
    plans[1]!.steps.map((step: { name: string }) => step.name),
    ["Skill_1_Begin", "Skill_1_Loop", "Skill_1_End"],
  );
  assert.deepEqual(
    plans[2]!.steps.map((step: { name: string }) => step.name),
    ["Skill_2_Begin", "Skill_2_Loop", "Skill_2_End"],
  );
  assert.equal(plans[0]!.queue[1].name, "Skill_Loop");
  assert.equal(plans[0]!.queue[1].loop, true);
  assert.equal(plans[0]!.queue[1].hold, 3);
  assert.equal(plans[0]!.queue.at(-1).name, "Idle");
  const alternatives = skillSequences(
    [...clips, { name: "Skill_2", duration: 1 }],
    skills,
  );
  assert.deepEqual(
    alternatives[2]!.steps.map((step: { name: string }) => step.name),
    ["Skill_2_Begin", "Skill_2_Loop", "Skill_2_End"],
  );
});

test("missing groups stay unavailable and explicit mappings still override numbering", () => {
  const fewer = skillSequences(
    clips.filter((clip) => !/Skill_[12]/.test(clip.name)),
    skills,
  );
  assert.equal(fewer[0], null);
  assert.equal(fewer[1], null);
  assert.ok(fewer[2]);
  const explicit = skillSequences(
    [...clips, { name: "Die", duration: 1 }],
    [
      { preview: "" },
      {
        preview: ["Skill_Begin", ["Skill_Loop", 3], "Die"],
        timing: { kind: "instant" },
      },
      { preview: ["Missing_Clip", "Idle"] },
    ],
  );
  assert.equal(explicit[0], null);
  assert.deepEqual(
    explicit[1]!.queue.map((item: { name: string }) => item.name),
    ["Skill_Begin", "Skill_Loop", "Skill_Loop", "Skill_Loop", "Die"],
  );
  assert.equal(explicit[1]!.returnTo, null);
  assert.equal(explicit[2], null);
});

test("metadata distinguishes timed, instant, ammo, passive and indefinite skills", () => {
  assert.deepEqual(
    skillTiming({ name: "Timed", durationType: "NONE", duration: 15 }),
    { kind: "timed", seconds: 15 },
  );
  assert.deepEqual(skillTiming({ name: "Instant", duration: 0 }), {
    kind: "instant",
  });
  assert.deepEqual(skillTiming({ name: "Infinite", duration: -1 }), {
    kind: "indefinite",
  });
  assert.deepEqual(
    skillTiming({ name: "Passive", skillType: "PASSIVE", duration: 0 }),
    { kind: "passive" },
  );
  assert.deepEqual(skillTiming({ name: "Missing" }), { kind: "unknown" });
  assert.deepEqual(
    skillTiming({
      name: "Holiday Storm",
      durationType: "AMMO",
      duration: -1,
      description:
        "Grants {attack@trigger_time} ammo (each attack consumes 2 ammo)",
      blackboard: [{ key: "attack@trigger_time", value: 32 }],
    }),
    { kind: "ammo", ammo: 32, perCycle: 2 },
  );
  assert.deepEqual(
    skillTiming({
      name: "Ammo zero",
      durationType: "AMMO",
      duration: 0,
      description: "Skill activation grants 31 bullets",
    }),
    { kind: "ammo", ammo: 31, perCycle: 1 },
  );
});

test("descriptions resolve source placeholders without injecting HTML and label their skill level", () => {
  const level = {
    name: "Skill",
    duration: 15,
    description:
      "ATK <@ba.vup>+{atk:0%}</>\nDeals {damage:0.0} damage to <$ba.stun>Stunned</> enemies; {-def}. {unknown}",
    blackboard: [
      { key: "atk", value: 1.2 },
      { key: "damage", value: 2.56 },
      { key: "def", value: -100 },
    ],
  };
  assert.equal(
    skillDescription(level),
    "ATK +120%\nDeals 2.6 damage to Stunned enemies; 100. {unknown}",
  );
  const info = skillInfo(
    "skill",
    Array.from({ length: 10 }, () => level),
  );
  assert.equal(info.levelLabel, "M3");
  assert.equal(info.timing!.kind, "timed");
});

test("icons use official aliases and skill metadata is imported with them", () => {
  const inventory = ["skel", "atlas", "png"].map((extension) => ({
    path: `char_001_test/front/char_001_test.${extension}`,
    type: "blob",
    sha: "a".repeat(40),
    size: 1,
  }));
  const { operators } = buildOperators(inventory, {}, {});
  addOperatorSkills(
    operators,
    {
      char_001_test: {
        skills: [{ skillId: "shared[3]" }, { skillId: "missing" }],
      },
    },
    {
      "shared[3]": {
        iconId: "alias",
        levels: [
          { name: "Actual skill name", description: "Once.", duration: 0 },
        ],
      },
    },
    [
      {
        path: "skill_icon_alias.png",
        type: "blob",
        sha: "a".repeat(40),
        size: 2,
      },
    ],
    { char_001_test: { skills: ["Skill"] } },
  );
  assert.equal(operators[0].skills[0].icon!.path, "skill_icon_alias.png");
  assert.equal(operators[0].skills[0].description, "Once.");
  assert.equal(operators[0].skills[0].timing!.kind, "instant");
  assert.equal(operators[0].skills[1].icon, null);
});

function runtimeState(runtimePath: string) {
  const runtime = vm.runInNewContext(
    `${readFileSync(new URL(runtimePath, import.meta.url), "utf8")}\nspine;`,
    {
      document: { addEventListener() {} },
      window: { addEventListener() {} },
      WebGLRenderingContext: { POINTS: 0, LINES: 1, TRIANGLES: 4 },
    },
  );
  const animations = new Map(
    clips.map((clip) => [
      clip.name,
      new runtime.Animation(clip.name, [], clip.duration),
    ]),
  );
  const data = new runtime.SkeletonData();
  data.animations = [...animations.values()];
  const skeleton = new runtime.Skeleton(data);
  const state = new runtime.AnimationState(
    new runtime.AnimationStateData(data),
  );
  const starts: string[] = [];
  state.addListener({
    start: (entry: { animation: { name: string } }) =>
      starts.push(entry.animation.name),
  });
  const advance = (seconds: number) => {
    for (let frame = 0; frame < Math.round(seconds * 120); frame++) {
      state.update(1 / 120);
      state.apply(skeleton);
    }
  };
  return { state, skeleton, starts, advance };
}

for (const [family, runtimePath] of [
  ["3.5/3.6", "../public/vendor/aceship/spine-widget.js"],
  ["3.7", "../public/vendor/spine/3.7/spine-webgl.js"],
  ["3.8", "../public/vendor/spine/3.8/spine-webgl.js"],
]) {
  test(`${family}: runtime loops for the full duration, synchronizes pause/speed, and exits smoothly`, () => {
    const { state, skeleton, starts, advance } = runtimeState(runtimePath);
    const playback = queueSkill(state, skillSequences(clips, skills)[0]!);
    state.apply(skeleton);
    state.timeScale = 0;
    advance(1);
    assert.deepEqual(starts, ["Skill_Begin"]);
    assert.equal(skillProgress(state, playback).remaining, 3);
    state.timeScale = 1;
    advance(2.2);
    assert.equal(state.tracks[0], playback.activeEntry);
    assert.deepEqual(starts, ["Skill_Begin", "Skill_Loop"]);
    const remaining = skillProgress(state, playback).remaining!;
    assert.ok(remaining > 0.8 && remaining < 1);
    state.timeScale = 0;
    advance(2);
    assert.equal(skillProgress(state, playback).remaining, remaining);
    state.timeScale = 2;
    advance(1);
    assert.deepEqual(starts, [
      "Skill_Begin",
      "Skill_Loop",
      "Skill_End",
      "Idle",
    ]);
    assert.equal(skillProgress(state, playback).complete, true);
    assert.equal(skillProgress(state, playback).remaining, 0);
    assert.equal(state.tracks.filter(Boolean).length, 1);
  });

  test(`${family}: ammo is counted per preview cycle and indefinite skills only exit on request`, () => {
    const ammoRuntime = runtimeState(runtimePath);
    const ammoSkills = [
      { timing: { kind: "ammo", ammo: 6, perCycle: 2 } },
      ...skills.slice(1),
    ];
    const ammo = queueSkill(
      ammoRuntime.state,
      skillSequences(clips, ammoSkills)[0]!,
    );
    ammoRuntime.state.apply(ammoRuntime.skeleton);
    ammoRuntime.advance(1.3);
    assert.equal(skillProgress(ammoRuntime.state, ammo).remaining, 4);
    assert.equal(skillProgress(ammoRuntime.state, ammo).maximum, 6);
    ammoRuntime.advance(3);
    assert.equal(skillProgress(ammoRuntime.state, ammo).remaining, 0);
    assert.equal(skillProgress(ammoRuntime.state, ammo).complete, true);
    const infiniteRuntime = runtimeState(runtimePath);
    const infinite = queueSkill(
      infiniteRuntime.state,
      skillSequences(clips, [
        { timing: { kind: "indefinite" } },
        ...skills.slice(1),
      ])[0]!,
    );
    infiniteRuntime.state.apply(infiniteRuntime.skeleton);
    infiniteRuntime.advance(5.5);
    assert.equal(infiniteRuntime.state.tracks[0].animation.name, "Skill_Loop");
    assert.equal(skillProgress(infiniteRuntime.state, infinite).maximum, null);
    endSkill(infiniteRuntime.state, infinite);
    infiniteRuntime.advance(1.5);
    assert.deepEqual(infiniteRuntime.starts, [
      "Skill_Begin",
      "Skill_Loop",
      "Skill_End",
      "Idle",
    ]);
    assert.equal(skillProgress(infiniteRuntime.state, infinite).complete, true);
  });

  test(`${family}: manual ending waits for a loop boundary and raw clip selection cancels the skill queue`, () => {
    const { state, skeleton, starts, advance } = runtimeState(runtimePath);
    const playback = queueSkill(state, skillSequences(clips, skills)[0]!);
    state.apply(skeleton);
    advance(0.4);
    endSkill(state, playback);
    advance(0.2);
    assert.equal(state.tracks[0].animation.name, "Skill_Loop");
    advance(1);
    assert.equal(skillProgress(state, playback).complete, true);
    assert.ok(playback.endAt! < 3);
    queueSkill(state, skillSequences(clips, skills)[0]!);
    state.apply(skeleton);
    advance(0.4);
    state.clearTracks();
    state.setAnimation(0, "Idle", true);
    state.apply(skeleton);
    const endCount = starts.filter((name) => name === "Skill_End").length;
    advance(5);
    assert.equal(
      starts.filter((name) => name === "Skill_End").length,
      endCount,
    );
  });
}
