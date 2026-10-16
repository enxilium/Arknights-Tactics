export type ViewName = "front" | "back" | "build";

export type AssetFile = {
  path: string;
  sha: string;
  size: number;
};

export type SpriteView = {
  name: ViewName;
  skeleton: AssetFile;
  atlas: AssetFile;
  textures: AssetFile[];
};

export type OperatorSkin = {
  id: string;
  name: string;
  views: SpriteView[];
};

export type Operator = {
  id: string;
  name: string;
  skins: OperatorSkin[];
  skills: OperatorSkill[];
};

export type SkillPreset = string | (string | [string, number])[];

export type SkillTiming =
  | { kind: "timed"; seconds: number }
  | { kind: "ammo"; ammo: number | null; perCycle: number }
  | { kind: "instant" | "indefinite" | "passive" | "unknown" };

export type SkillInfo = {
  id: string;
  name: string;
  description?: string;
  timing?: SkillTiming;
  levelLabel?: string;
  activation?: string;
};

export type OperatorSkill = SkillInfo & {
  icon: AssetFile | null;
  preview?: SkillPreset;
};

export type Catalog = {
  version: 3;
  revision: string;
  fetchedAt: string;
  operators: Operator[];
  files: Record<string, AssetFile>;
};

export type CatalogResponse = {
  fetchedAt: string;
  stale: boolean;
  warning?: string;
  operators: {
    id: string;
    name: string;
    skins: { id: string; name: string; views: ViewName[]; bytes: number }[];
  }[];
};

export type ImportManifest = {
  version: 1 | 2 | 3;
  operator: { id: string; name: string };
  skin: { id: string; name: string };
  importedAt: string;
  revision: string;
  source: string;
  directory: string;
  views: {
    name: ViewName;
    skeleton: string;
    atlas: string;
    textures: string[];
  }[];
  files: { path: string; bytes: number; sha: string }[];
  skillRevision?: string;
  skills?: (SkillInfo & {
    icon: string | null;
    preview?: SkillPreset;
  })[];
};

export type ImportResponse = {
  manifest: ImportManifest;
  manifestUrl: string;
  cached: boolean;
};
