import React from "react";
import { useTranslation } from "react-i18next";
import { Select, SelectItem } from "@heroui/react";
import { I18nKey } from "#/i18n/declaration";
import { SettingsInput } from "#/components/features/settings/settings-input";
import { useActiveBackendContext } from "#/contexts/active-backend-context";
import { defaultModelSupportsVision } from "#/api/model-vision/default-vision-models";
import {
  getModelVisionOverride,
  setModelVisionOverride,
  clearModelVisionOverride,
} from "#/api/model-vision/vision-config-store";
import type { Image2TextConverterConfig } from "#/api/model-vision/types";
import { BrandButton } from "#/components/features/settings/brand-button";

interface ModelVisionSettingsProps {
  /** The `provider/model` id currently selected, or `null` if none yet. */
  modelId: string | null;
}

type ConverterType = Image2TextConverterConfig["type"];

/**
 * Lets the user flag a model as vision-incapable and, when they do, pick an
 * image2text converter (another registered backend, or an external
 * OpenAI-compatible endpoint) used to describe attached images as text
 * before they're folded into the prompt. Persisted per-model in
 * localStorage — see `#/api/model-vision`.
 */
export function ModelVisionSettings({ modelId }: ModelVisionSettingsProps) {
  const { t } = useTranslation("openhands");
  const { backends } = useActiveBackendContext();

  const [unsupported, setUnsupported] = React.useState(false);
  const [converterType, setConverterType] =
    React.useState<ConverterType>("backend");
  const [backendId, setBackendId] = React.useState<string>("");
  const [converterModel, setConverterModel] = React.useState("");
  const [endpointUrl, setEndpointUrl] = React.useState("");
  const [endpointApiKey, setEndpointApiKey] = React.useState("");

  React.useEffect(() => {
    if (!modelId) return;
    const override = getModelVisionOverride(modelId);
    if (override) {
      setUnsupported(!override.supportsVision);
      if (override.converter?.type === "backend") {
        setConverterType("backend");
        setBackendId(override.converter.backendId);
        setConverterModel(override.converter.model);
      } else if (override.converter?.type === "endpoint") {
        setConverterType("endpoint");
        setEndpointUrl(override.converter.url);
        setEndpointApiKey(override.converter.apiKey ?? "");
        setConverterModel(override.converter.model ?? "");
      }
    } else {
      setUnsupported(!defaultModelSupportsVision(modelId));
    }
  }, [modelId]);

  if (!modelId) return null;

  const canSave =
    !unsupported ||
    (converterType === "backend"
      ? backendId.length > 0 && converterModel.trim().length > 0
      : endpointUrl.trim().length > 0);

  const handleSave = () => {
    if (!unsupported) {
      clearModelVisionOverride(modelId);
      return;
    }
    const converter: Image2TextConverterConfig | undefined =
      converterType === "backend"
        ? backendId && converterModel
          ? { type: "backend", backendId, model: converterModel.trim() }
          : undefined
        : endpointUrl
          ? {
              type: "endpoint",
              url: endpointUrl.trim(),
              apiKey: endpointApiKey.trim() || undefined,
              model: converterModel.trim() || undefined,
            }
          : undefined;
    setModelVisionOverride(modelId, { supportsVision: false, converter });
  };

  return (
    <fieldset className="flex flex-col gap-2.5 w-full">
      <label className="text-sm">{t(I18nKey.MODEL$VISION_SECTION_TITLE)}</label>
      <label className="flex items-center gap-2 text-sm text-[var(--oh-text-secondary)]">
        <input
          type="checkbox"
          checked={unsupported}
          onChange={(e) => setUnsupported(e.target.checked)}
          data-testid="model-vision-unsupported-toggle"
        />
        {t(I18nKey.MODEL$VISION_UNSUPPORTED_TOGGLE)}
      </label>

      {unsupported ? (
        <div className="flex flex-col gap-2.5 pl-6">
          <span className="text-sm">
            {t(I18nKey.MODEL$VISION_CONVERTER_LABEL)}
          </span>
          <Select
            aria-label={t(I18nKey.MODEL$VISION_CONVERTER_LABEL)}
            selectedKeys={[converterType]}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0];
              if (value) setConverterType(value as ConverterType);
            }}
            data-testid="model-vision-converter-type"
          >
            <SelectItem key="backend">
              {t(I18nKey.MODEL$VISION_CONVERTER_TYPE_BACKEND)}
            </SelectItem>
            <SelectItem key="endpoint">
              {t(I18nKey.MODEL$VISION_CONVERTER_TYPE_ENDPOINT)}
            </SelectItem>
          </Select>

          {converterType === "backend" ? (
            <>
              <Select
                aria-label={t(I18nKey.MODEL$VISION_CONVERTER_BACKEND_LABEL)}
                selectedKeys={backendId ? [backendId] : []}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0];
                  setBackendId(value ? String(value) : "");
                }}
                data-testid="model-vision-converter-backend"
              >
                {backends.map((backend) => (
                  <SelectItem key={backend.id}>{backend.name}</SelectItem>
                ))}
              </Select>
              <SettingsInput
                testId="model-vision-converter-model"
                label={t(I18nKey.MODEL$VISION_CONVERTER_MODEL_LABEL)}
                type="text"
                value={converterModel}
                onChange={setConverterModel}
                className="w-full"
              />
            </>
          ) : (
            <>
              <SettingsInput
                testId="model-vision-converter-url"
                label={t(I18nKey.MODEL$VISION_CONVERTER_URL_LABEL)}
                type="text"
                value={endpointUrl}
                onChange={setEndpointUrl}
                className="w-full"
              />
              <SettingsInput
                testId="model-vision-converter-api-key"
                label={t(I18nKey.MODEL$VISION_CONVERTER_API_KEY_LABEL)}
                type="password"
                value={endpointApiKey}
                onChange={setEndpointApiKey}
                className="w-full"
              />
              <SettingsInput
                testId="model-vision-converter-endpoint-model"
                label={t(I18nKey.MODEL$VISION_CONVERTER_MODEL_LABEL)}
                type="text"
                value={converterModel}
                onChange={setConverterModel}
                className="w-full"
              />
            </>
          )}
        </div>
      ) : null}

      <BrandButton
        type="button"
        variant="secondary"
        isDisabled={!canSave}
        onClick={handleSave}
        testId="model-vision-save"
      >
        {t(I18nKey.MODEL$VISION_SAVE)}
      </BrandButton>
    </fieldset>
  );
}
