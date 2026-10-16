"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CatalogResponse,
  ImportResponse,
  ViewName,
} from "@/lib/data-types";

const VIEW_LABELS: Record<ViewName, string> = {
  front: "Front",
  back: "Back",
  build: "Base",
};
const bytesLabel = (bytes: number) => `${(bytes / 1_000_000).toFixed(2)} MB`;

async function resultJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data as T;
}

export default function DataWorkshop({
  initialCatalog,
  initialError,
}: {
  initialCatalog: CatalogResponse | null;
  initialError: string;
}) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(
    initialCatalog,
  );
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [operatorId, setOperatorId] = useState(
    () =>
      (
        initialCatalog?.operators.find(
          (operator) => operator.id === "char_1013_chen2",
        ) ?? initialCatalog?.operators[0]
      )?.id ?? "",
  );
  const [skinId, setSkinId] = useState("");
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [imported, setImported] = useState<ImportResponse | null>(null);
  const [viewName, setViewName] = useState<ViewName>("front");
  const [error, setError] = useState(initialError);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const viewer = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onSkillSelected(event: MessageEvent) {
      if (
        event.origin !== location.origin ||
        event.source !== viewer.current?.contentWindow ||
        event.data?.type !== "skill-selected"
      )
        return;
      if (
        imported?.manifest.skills?.some((skill) => skill.id === event.data.id)
      )
        setSelectedSkillId(event.data.id);
    }
    window.addEventListener("message", onSkillSelected);
    return () => window.removeEventListener("message", onSkillSelected);
  }, [imported]);

  async function loadCatalog(refresh = false) {
    try {
      const next = await resultJson<CatalogResponse>(
        await fetch(`/api/data/catalog${refresh ? "?refresh=1" : ""}`, {
          cache: "no-store",
        }),
      );
      setCatalog(next);
      setImported(null);
      setOperatorId((current) =>
        next.operators.some((operator) => operator.id === current)
          ? current
          : (
              next.operators.find(
                (operator) => operator.id === "char_1013_chen2",
              ) ?? next.operators[0]
            ).id,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load the catalog.",
      );
    } finally {
      setLoadingCatalog(false);
    }
  }

  function refreshCatalog(force = false) {
    setLoadingCatalog(true);
    setError("");
    void loadCatalog(force);
  }

  const operator = catalog?.operators.find(
    (candidate) => candidate.id === operatorId,
  );
  // Derive a valid outfit immediately when the operator or refreshed inventory changes.
  const skin =
    operator?.skins.find((candidate) => candidate.id === skinId) ??
    operator?.skins[0];
  const visibleOperators =
    catalog?.operators.filter((candidate) =>
      `${candidate.name} ${candidate.id}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
    ) ?? [];
  const outfitCount =
    catalog?.operators.reduce(
      (sum, candidate) => sum + candidate.skins.length,
      0,
    ) ?? 0;

  function chooseOperator(id: string) {
    setOperatorId(id);
    setSkinId("");
    setImported(null);
    setError("");
  }

  async function download() {
    if (!operator || !skin) return;
    setDownloading(true);
    setError("");
    setImported(null);
    try {
      const next = await resultJson<ImportResponse>(
        await fetch("/api/data/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operatorId: operator.id, skinId: skin.id }),
        }),
      );
      setImported(next);
      setSelectedSkillId("");
      setViewName(next.manifest.views[0].name);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The download failed.",
      );
    } finally {
      setDownloading(false);
    }
  }

  const manifest = imported?.manifest;
  const localBase = imported?.manifestUrl.slice(0, -"manifest.json".length);
  const selectedSkill =
    manifest?.skills?.find((skill) => skill.id === selectedSkillId) ??
    manifest?.skills?.[0];
  const timing = selectedSkill?.timing;
  const timingLabel =
    timing?.kind === "timed"
      ? `Timed · ${timing.seconds}s`
      : timing?.kind === "ammo"
        ? `Ammo${timing.ammo ? ` · ${timing.ammo} rounds` : ""}`
        : timing?.kind === "instant"
          ? "Instant use"
          : timing?.kind === "indefinite"
            ? "Indefinite"
            : timing?.kind === "passive"
              ? "Passive"
              : "Duration unavailable";

  return (
    <main className="debug-page">
      <header className="page-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            A<span>/</span>T
          </span>
          <div>
            <span className="eyebrow">ARKNIGHTS TACTICS</span>
            <h1>Operator workshop</h1>
          </div>
        </div>
        <span className="environment">
          <span aria-hidden="true" />
          LOCAL DEBUG
        </span>
      </header>

      <div className="workshop">
        <aside className="sidebar">
          <div className="section-heading">
            <span className="step-number">01</span>
            <h2>Choose your operator</h2>
          </div>
          <p className="muted intro">
            Available sprites, straight from Aceship’s Toolbox.
          </p>
          <div className="catalog-meta" aria-live="polite">
            {catalog ? (
              <>
                <strong>{catalog.operators.length}</strong> operators{" "}
                <span>·</span> <strong>{outfitCount}</strong> outfits
              </>
            ) : (
              "Reading Aceship’s inventory…"
            )}
          </div>

          <fieldset
            disabled={loadingCatalog || downloading || !catalog}
            className="selection-fields"
          >
            <label htmlFor="operator-search">Find an operator</label>
            <input
              id="operator-search"
              type="search"
              placeholder="Search by name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <label htmlFor="operator">Operator</label>
            <select
              id="operator"
              value={operatorId}
              onChange={(event) => chooseOperator(event.target.value)}
            >
              {operator &&
                !visibleOperators.some(
                  (candidate) => candidate.id === operator.id,
                ) && (
                  <option value={operator.id}>
                    {operator.name} (selected)
                  </option>
                )}
              {visibleOperators.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
            {catalog && !visibleOperators.length && (
              <p className="muted search-note">
                No operators match that search.
              </p>
            )}
            <label htmlFor="skin">Outfit</label>
            <select
              id="skin"
              value={skin?.id ?? ""}
              onChange={(event) => {
                setSkinId(event.target.value);
                setImported(null);
                setError("");
              }}
            >
              {operator?.skins.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </fieldset>

          {skin && (
            <div className="bundle-info">
              <span className="eyebrow">IN THIS BUNDLE</span>
              <div className="view-badges">
                {skin.views.map((view) => (
                  <span key={view}>{VIEW_LABELS[view]}</span>
                ))}
              </div>
              <p className="muted">
                All available views and animations.
                <br />
                Approximately {bytesLabel(skin.bytes)} of source files.
              </p>
            </div>
          )}

          <button
            className="primary-button"
            onClick={() => void download()}
            disabled={!skin || downloading || loadingCatalog}
          >
            {downloading ? (
              <>
                <span className="spinner" />
                Downloading all views…
              </>
            ) : (
              <>
                <span aria-hidden="true">↓</span> Download &amp; preview
              </>
            )}
          </button>
          <p className="download-note" aria-live="polite">
            {downloading
              ? "Verifying each file before saving. This may take a moment."
              : "Saved bundles load from disk on the next click."}
          </p>

          <div className="source-details">
            <a
              href="https://github.com/Aceship/Arknight-Images/tree/main/spineassets/character"
              target="_blank"
              rel="noreferrer"
            >
              Browse source assets <span aria-hidden="true">↗</span>
            </a>
            <button
              className="text-button"
              onClick={() => refreshCatalog(true)}
              disabled={loadingCatalog || downloading}
            >
              {loadingCatalog ? "Fetching inventory…" : "Refresh from Aceship"}
            </button>
            {catalog && (
              <p className="muted timestamp">
                Inventory fetched {new Date(catalog.fetchedAt).toLocaleString()}
              </p>
            )}
          </div>
        </aside>

        <section className="preview-panel" aria-label="Operator preview">
          <div className="preview-heading">
            <div>
              <span className="eyebrow">02 / ANIMATION PREVIEW</span>
              <h2>{manifest?.operator.name ?? "Your operator goes here"}</h2>
              <p className="muted">
                {manifest?.skin.name ??
                  "Pick an outfit and download its sprite bundle to begin."}
              </p>
            </div>
            {manifest && (
              <span className="local-badge">
                {imported.cached ? "LOADED FROM DISK" : "SAVED LOCALLY"}
              </span>
            )}
          </div>

          {error && (
            <div className="error-message" role="alert">
              {error}
              {!catalog && !loadingCatalog && (
                <button
                  className="text-button"
                  onClick={() => refreshCatalog()}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {catalog?.stale && (
            <div className="warning-message" role="status">
              Showing the saved inventory. {catalog.warning}
            </div>
          )}

          {imported ? (
            <>
              <div
                className="view-tabs"
                role="group"
                aria-label="Sprite perspective"
              >
                {manifest!.views.map((view) => (
                  <button
                    key={view.name}
                    className={viewName === view.name ? "active" : ""}
                    aria-pressed={viewName === view.name}
                    onClick={() => setViewName(view.name)}
                  >
                    {VIEW_LABELS[view.name]}
                  </button>
                ))}
                <span className="muted">
                  Spine · original source animations
                </span>
              </div>
              <iframe
                ref={viewer}
                className="sprite-viewer"
                title={`${manifest!.operator.name} ${VIEW_LABELS[viewName]} animation player`}
                key={`${imported.manifestUrl}:${viewName}`}
                src={`/viewer.html?manifest=${encodeURIComponent(imported.manifestUrl)}&view=${viewName}`}
              />
              {selectedSkill && (
                <section
                  className="skill-details"
                  aria-label="Selected skill description"
                >
                  <div className="files-heading">
                    <h3>{selectedSkill.name}</h3>
                    <span>
                      {timingLabel} · {selectedSkill.levelLabel}
                    </span>
                  </div>
                  <p className="skill-description">
                    {selectedSkill.description ||
                      "Description unavailable from the source."}
                  </p>
                  <p className="muted skill-note">
                    Maximum skill level ·{" "}
                    {selectedSkill.activation === "AUTO"
                      ? "Automatic activation"
                      : selectedSkill.activation === "PASSIVE"
                        ? "Always active"
                        : "Manual activation"}
                    {timing?.kind === "ammo" &&
                      ` · Preview spends ${timing.perCycle} ammo per animation cycle; target conditions and talents are not simulated.`}
                    {timing?.kind === "indefinite" &&
                      " · Use End skill to finish the preview."}
                  </p>
                </section>
              )}
              <section className="saved-files" aria-label="Downloaded files">
                <div className="files-heading">
                  <h3>On your disk</h3>
                  <span>
                    {manifest!.files.length} files ·{" "}
                    {bytesLabel(
                      manifest!.files.reduce(
                        (sum, file) => sum + file.bytes,
                        0,
                      ),
                    )}
                  </span>
                </div>
                <code className="saved-path">{manifest!.directory}/</code>
                <details>
                  <summary>Browse bundle files</summary>
                  <ul>
                    {manifest!.files.map((file) => (
                      <li key={file.path}>
                        <a
                          href={`${localBase}${file.path.split("/").map(encodeURIComponent).join("/")}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {file.path}
                        </a>
                        <span>{(file.bytes / 1024).toFixed(1)} KB</span>
                      </li>
                    ))}
                    <li>
                      <a
                        href={imported.manifestUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        manifest.json
                      </a>
                      <span>bundle index</span>
                    </li>
                  </ul>
                </details>
              </section>
            </>
          ) : (
            <div className="empty-preview">
              <div className="empty-symbol" aria-hidden="true">
                <span>+</span>
              </div>
              <span className="eyebrow">AWAITING OPERATOR</span>
              <p>One outfit. Every available animation.</p>
              <span className="muted">
                Your local testing ground for the game.
              </span>
            </div>
          )}
        </section>
      </div>
      <footer className="page-footer">
        <span>ARKNIGHTS TACTICS / ASSET WORKSPACE</span>
        <span>Source assets remain in their original Spine format.</span>
      </footer>
    </main>
  );
}
