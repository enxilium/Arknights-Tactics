// Asset names are not skill numbers. Keep Aceship's explicit mappings and its
// trailing-N group fallback, but let gameplay metadata own skill lifetime.
export function skillSequences(clips, skills) {
  const byName = new Map(clips.map((clip) => [clip.name, clip]));
  const resting =
    ["Idle_Charge", "Idle", "Relax"].find((name) => byName.has(name)) ?? null;
  const groups = new Map();
  for (const clip of clips) {
    if (
      !/^Skill(?:_|\d|$)/i.test(clip.name) ||
      /Down|Daze|Stun|Die|Death/i.test(clip.name)
    )
      continue;
    const key = clip.name.match(/\d+/)?.[0] ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(clip);
  }
  const ordered = [...groups.entries()].sort(
    ([a], [b]) => (a === "" ? -1 : Number(a)) - (b === "" ? -1 : Number(b)),
  );
  const phase = (name) =>
    /End|Finish/i.test(name)
      ? 6
      : /Pre/i.test(name)
        ? 0
        : /Begin/i.test(name)
          ? 1
          : /Start/i.test(name)
            ? 2
            : /Idle/i.test(name)
              ? 3
              : /Loop/i.test(name)
                ? 5
                : 4;
  return skills.map((skill, index) => {
    const timing = skill.timing ?? { kind: "unknown" };
    if (timing.kind === "passive") return null;
    let steps;
    if (skill.preview !== undefined) {
      const preset =
        typeof skill.preview === "string" ? [skill.preview] : skill.preview;
      steps = preset.filter(Boolean).map((step) => ({
        name: Array.isArray(step) ? step[0] : step,
        repeat: Array.isArray(step) ? step[1] : 1,
      }));
    } else {
      const group = ordered[ordered.length - skills.length + index]?.[1];
      if (!group) return null;
      steps = [...group]
        .sort(
          (a, b) =>
            phase(a.name) - phase(b.name) || a.name.localeCompare(b.name),
        )
        .map((clip) => ({ name: clip.name, repeat: 1 }));
    }
    if (
      !steps.length ||
      steps.some(
        (step) =>
          !byName.has(step.name) ||
          !Number.isInteger(step.repeat) ||
          step.repeat < 1 ||
          step.repeat > 32,
      )
    )
      return null;
    steps = steps.filter((step) => step.name !== resting);
    if (!steps.length) return null;
    let active =
      steps.find(
        (step) => /Loop/i.test(step.name) && !/End/i.test(step.name),
      ) ??
      steps.find(
        (step) =>
          /Attack|Heal/i.test(step.name) && !/Begin|Start|End/i.test(step.name),
      ) ??
      steps.find(
        (step) =>
          !/Pre|Begin|Start|End|Idle|Sleep|Awake|Die|Death/i.test(step.name),
      ) ??
      steps.find((step) => /Idle/i.test(step.name));
    if (!active) active = steps[0];
    // Skill-idle is a combat stance, not an extra phase before every attack loop.
    steps = steps.filter((step) => step === active || !/Idle/i.test(step.name));
    if (skill.preview === undefined)
      steps = steps.filter(
        (step) =>
          step === active || /Pre|Begin|Start|End|Finish/i.test(step.name),
      );
    const activeIndex = steps.indexOf(active);
    const sustained = ["timed", "ammo", "indefinite"].includes(timing.kind);
    const cycle = byName.get(active.name).duration;
    if (sustained && !(cycle > 0)) return null;
    const hold =
      timing.kind === "timed"
        ? timing.seconds
        : timing.kind === "ammo" && timing.ammo
          ? Math.ceil(timing.ammo / timing.perCycle) * cycle
          : null;
    const returnTo = /Die|Death/i.test(steps.at(-1).name) ? null : resting;
    const expand = (items, role) =>
      items.flatMap((step) =>
        Array.from({ length: step.repeat }, () => ({
          name: step.name,
          loop: false,
          role,
        })),
      );
    let queue;
    let outro = [];
    if (sustained) {
      outro = expand(steps.slice(activeIndex + 1), "end");
      if (returnTo) outro.push({ name: returnTo, loop: true, role: "rest" });
      queue = [
        ...expand(steps.slice(0, activeIndex), "start"),
        { name: active.name, loop: true, role: "active", hold },
        ...(hold === null ? [] : outro),
      ];
    } else {
      queue = steps.flatMap((step, position) =>
        expand(
          [step],
          position < activeIndex
            ? "start"
            : position === activeIndex
              ? "active"
              : "end",
        ),
      );
      if (returnTo) queue.push({ name: returnTo, loop: true, role: "rest" });
    }
    const mix = (previous, item) =>
      previous && previous.name !== item.name
        ? Math.min(
            0.08,
            byName.get(previous.name).duration / 4,
            byName.get(item.name).duration / 4,
          )
        : 0;
    for (const [position, item] of queue.entries())
      item.mix = mix(queue[position - 1], item);
    for (const [position, item] of outro.entries())
      item.mix = mix(
        position ? outro[position - 1] : { name: active.name },
        item,
      );
    return {
      steps,
      queue,
      outro,
      returnTo,
      timing,
      sustained,
      cycle,
      activeName: active.name,
      hold,
    };
  });
}

function enqueue(state, previous, item) {
  state.data.setMix(previous.animation.name, item.name, item.mix);
  // Explicit delay lets one looping entry run for the actual active duration.
  const entry = state.addAnimation(
    0,
    item.name,
    item.loop,
    previous.skillHold ?? 0,
  );
  entry.mixDuration = item.mix;
  entry.skillHold = item.hold;
  return entry;
}

export function queueSkill(state, plan) {
  state.clearTracks();
  const playback = {
    plan,
    entries: [],
    activeEntry: null,
    restEntry: null,
    endingEntries: [],
    endingRequested: false,
    endAt: plan.hold,
  };
  for (const [index, item] of plan.queue.entries()) {
    const entry =
      index === 0
        ? state.setAnimation(0, item.name, item.loop)
        : enqueue(state, playback.entries.at(-1), item);
    entry.mixDuration = item.mix;
    entry.skillHold = item.hold;
    playback.entries.push(entry);
    if (item.role === "active" && !playback.activeEntry)
      playback.activeEntry = entry;
    if (item.role === "rest") playback.restEntry = entry;
    if (item.role === "end") playback.endingEntries.push(entry);
  }
  return playback;
}

export function endSkill(state, playback) {
  if (!playback?.plan.sustained || playback.endingRequested) return;
  const active = playback.activeEntry;
  const cycle = playback.plan.cycle;
  const boundary =
    (Math.floor(Math.max(0, active.trackTime) / cycle) + 1) * cycle;
  playback.endingRequested = true;
  playback.endAt = Math.min(playback.endAt ?? Infinity, boundary);
  if (active.next) active.next.delay = playback.endAt;
  else {
    let previous = active;
    for (const item of playback.plan.outro) {
      const entry = enqueue(state, previous, item);
      if (previous === active) entry.delay = playback.endAt;
      playback.entries.push(entry);
      if (item.role === "rest") playback.restEntry = entry;
      else playback.endingEntries.push(entry);
      previous = entry;
    }
  }
}

// The UI reads the same track time that animates the operator. No wall-clock timers.
export function skillProgress(state, playback) {
  const { plan, activeEntry, restEntry } = playback;
  const current = state.tracks[0];
  const complete =
    current === restEntry ||
    (current === activeEntry &&
      !current.loop &&
      !current.next &&
      current.trackTime >= current.animation.duration) ||
    (!restEntry &&
      playback.endingEntries.includes(current) &&
      current.trackTime >= current.animation.duration);
  const phase = complete
    ? "complete"
    : current === activeEntry
      ? "active"
      : playback.endingEntries.includes(current)
        ? "ending"
        : "starting";
  const elapsed =
    phase === "active"
      ? current.trackTime
      : phase === "starting"
        ? 0
        : (playback.endAt ?? 0);
  let maximum = null;
  let remaining = null;
  let label = "Instant use";
  if (plan.timing.kind === "timed") {
    maximum = plan.timing.seconds;
    remaining = Math.max(0, maximum - elapsed);
    label = `${remaining.toFixed(1)}s / ${maximum}s`;
  } else if (plan.timing.kind === "ammo") {
    maximum = plan.timing.ammo;
    remaining =
      maximum === null
        ? null
        : Math.max(
            0,
            maximum -
              Math.floor((elapsed + 1e-8) / plan.cycle) * plan.timing.perCycle,
          );
    label =
      maximum === null
        ? "Ammo count unavailable · end manually"
        : `${remaining} / ${maximum} ammo · preview`;
  } else if (plan.timing.kind === "indefinite")
    label = "Indefinite · end manually";
  else if (plan.timing.kind === "unknown") label = "Duration unavailable";
  if (complete)
    label = playback.endingRequested
      ? `Ended early · ${label}`
      : `Complete · ${label}`;
  return {
    phase,
    clip: current?.animation.name ?? "",
    maximum,
    remaining,
    label,
    complete,
    canEnd:
      plan.sustained &&
      !playback.endingRequested &&
      ["starting", "active"].includes(phase),
  };
}
