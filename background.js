chrome.runtime.onInstalled.addListener(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ocrFrame") return;

  (async () => {
    const { visionApiKey } = await chrome.storage.local.get("visionApiKey");

    if (!visionApiKey) {
      sendResponse({
        ok: false,
        error: "Missing Google Vision API key. Add it in the extension popup.",
      });
      return;
    }

    let response;
    try {
      response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(visionApiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [
              {
                image: { content: message.imageBase64 },
                features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              },
            ],
          }),
        },
      );
    } catch (err) {
      sendResponse({ ok: false, error: `Network error: ${err.message}` });
      return;
    }

    const data = await response.json();
    const visionError = data?.responses?.[0]?.error;

    if (!response.ok || visionError) {
      sendResponse({
        ok: false,
        error: visionError?.message ?? "Vision API request failed.",
      });
      return;
    }

    const words = extractWords(data.responses[0].fullTextAnnotation);
    sendResponse({ ok: true, words });
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message ?? "Unexpected error." });
  });

  return true;
});

function extractWords(annotation) {
  const words = [];

  for (const page of annotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const word of paragraph.words ?? []) {
          const text = (word.symbols ?? []).map((s) => s.text).join("");
          const box = verticesToBox(word.boundingBox?.vertices);
          if (text && box) words.push({ text, box });
        }
      }
    }
  }

  return words;
}

function verticesToBox(vertices = []) {
  if (!vertices.length) return null;

  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);

  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return {
    left,
    top,
    width: Math.max(0, Math.max(...xs) - left),
    height: Math.max(0, Math.max(...ys) - top),
  };
}
