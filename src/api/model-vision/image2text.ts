import type { Backend } from "#/api/backend-registry/types";
import type { Image2TextConverterConfig } from "./types";

const DEFAULT_IMAGE2TEXT_PROMPT =
  "Describe this image in detail, transcribing any visible text verbatim. " +
  "Be thorough — your description is the only way a text-only reader can " +
  "know what's in the image.";

interface ChatCompletionsTarget {
  url: string;
  apiKey?: string;
  model: string;
}

function resolveTarget(
  converter: Image2TextConverterConfig,
  backends: Backend[],
): ChatCompletionsTarget {
  if (converter.type === "endpoint") {
    return {
      url: converter.url,
      apiKey: converter.apiKey,
      model: converter.model ?? "gpt-4o",
    };
  }

  const backend = backends.find((b) => b.id === converter.backendId);
  if (!backend) {
    throw new Error(
      `Image2text converter references an unknown backend (${converter.backendId}).`,
    );
  }
  return {
    // Assumes an OpenAI-compatible chat-completions route is reachable at
    // the backend's host. This is the lowest-common-denominator shape most
    // LLM gateways (including litellm-fronted agent-servers) expose.
    url: `${backend.host.replace(/\/+$/, "")}/v1/chat/completions`,
    apiKey: backend.apiKey,
    model: converter.model,
  };
}

/**
 * Convert a single image (data URL or http(s) URL) to descriptive text using
 * the configured image2text converter. Used when the active chat model lacks
 * vision support, so the image content can be folded into the plain-text
 * prompt instead of sent as an `image` content block.
 */
export async function convertImageToText(
  imageUrl: string,
  converter: Image2TextConverterConfig,
  backends: Backend[],
): Promise<string> {
  const target = resolveTarget(converter, backends);

  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: target.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: DEFAULT_IMAGE2TEXT_PROMPT },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Image2text conversion failed (${response.status} ${response.statusText}).`,
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Image2text conversion returned no text.");
  }
  return text;
}

/**
 * Convert every image in `imageUrls` to text, in order, and join the results
 * into a single block ready to append to the outgoing message text.
 * Individual failures are inlined as an error note rather than aborting the
 * whole send — losing one image's description shouldn't block the message.
 */
export async function convertImagesToText(
  imageUrls: string[],
  converter: Image2TextConverterConfig,
  backends: Backend[],
): Promise<string> {
  const descriptions = await Promise.all(
    imageUrls.map(async (url, index) => {
      try {
        const text = await convertImageToText(url, converter, backends);
        return `[Image ${index + 1}]: ${text}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `[Image ${index + 1}]: (image2text conversion failed — ${message})`;
      }
    }),
  );
  return descriptions.join("\n\n");
}
