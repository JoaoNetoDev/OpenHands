import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import {
  readFeatureDoc,
  listFeatureSprintFiles,
} from "#/api/kanban-pipeline.api";
import { BrandButton } from "#/components/features/settings/brand-button";
import { MarkdownRenderer } from "#/components/features/markdown/markdown-renderer";

const DOC_FILES = ["PRD.md", "TECH.md", "SPEC.md"] as const;

interface FeatureDocsPanelProps {
  workspacePath: string;
  slug: string;
}

type DocState = { exists: true; content: string } | { exists: false };

/**
 * Read-only panel showing the feature's PRD/TECH/SPEC docs (rendered as
 * Markdown) plus the list of sprint files, all read from the workspace
 * filesystem via `readFeatureDoc`/`listFeatureSprintFiles` (SPEC §2.6).
 *
 * A document that doesn't exist yet (`{ exists: false }`) always renders
 * the "(ainda não gerado)" placeholder — never an error state (RNF-01):
 * `readFeatureDoc` never throws for a missing file, so there's no error
 * branch to render here in the first place.
 *
 * No automatic polling — `refresh()` only runs on mount and on the
 * "Atualizar" button click (YAGNI, TECH §2.4).
 */
export function FeatureDocsPanel({
  workspacePath,
  slug,
}: FeatureDocsPanelProps) {
  const { t } = useTranslation("openhands");
  const [docs, setDocs] = React.useState<Record<string, DocState>>({});
  const [sprintFiles, setSprintFiles] = React.useState<string[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    const entries = await Promise.all(
      DOC_FILES.map(async (name) => {
        const result = await readFeatureDoc(
          workspacePath,
          `docs/features/${slug}/${name}`,
        );
        return [name, result] as const;
      }),
    );
    setDocs(Object.fromEntries(entries));
    setSprintFiles(await listFeatureSprintFiles(workspacePath, slug));
    setIsLoading(false);
  }, [workspacePath, slug]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div
      data-testid="kanban-feature-docs-panel"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">
          {t(I18nKey.KANBAN$FEATURE_DOCS_TITLE)}
        </h3>
        <BrandButton
          testId="kanban-refresh-docs-button"
          type="button"
          variant="secondary"
          isDisabled={isLoading}
          onClick={() => void refresh()}
        >
          {t(I18nKey.KANBAN$REFRESH_DOCS)}
        </BrandButton>
      </div>

      {DOC_FILES.map((name) => {
        const doc = docs[name];
        return (
          <details
            key={name}
            data-testid={`kanban-feature-doc-${name}`}
            className="rounded-lg border border-[var(--oh-border)] p-2 text-sm text-white"
          >
            <summary>
              {name}
              {!doc?.exists && (
                <span
                  data-testid={`kanban-feature-doc-missing-${name}`}
                  className="ml-2 text-xs text-gray-400"
                >
                  ({t(I18nKey.KANBAN$DOC_NOT_GENERATED_YET)})
                </span>
              )}
            </summary>
            {doc?.exists && (
              <div className="mt-2">
                <MarkdownRenderer includeStandard includeHeadings>
                  {doc.content}
                </MarkdownRenderer>
              </div>
            )}
          </details>
        );
      })}

      <div>
        <h4 className="text-xs font-semibold text-gray-400">
          {t(I18nKey.KANBAN$FEATURE_SPRINTS_TITLE)}
        </h4>
        {sprintFiles.length === 0 ? (
          <p
            data-testid="kanban-feature-sprints-empty"
            className="text-xs text-gray-400"
          >
            ({t(I18nKey.KANBAN$DOC_NOT_GENERATED_YET)})
          </p>
        ) : (
          <ul>
            {sprintFiles.map((f) => (
              <li key={f} className="text-xs text-white">
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
