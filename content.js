const OVERLAY_ID = "browser-video-ocr-overlay";
const BUTTON_ID = "browser-video-ocr-btn";

let activeVideo = null;
let activeOverlay = null;
let ocrButton = null;
let processing = false;

function getOrCreateButton() {
  if (ocrButton) return ocrButton;

  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.textContent = "OCR";

  Object.assign(btn.style, {
    position: "fixed",
    zIndex: "2147483647",
    padding: "6px 14px",
    borderRadius: "6px",
    border: "none",
    background: "rgba(20,20,20,0.82)",
    color: "#fff",
    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",
    fontWeight: "600",
    letterSpacing: "0.04em",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
    backdropFilter: "blur(6px)",
    userSelect: "none",
    transition: "opacity 0.15s, transform 0.1s",
    display: "none",
  });

  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "scale(1.06)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "scale(1)";
  });
  btn.addEventListener("click", onButtonClick);

  document.body.appendChild(btn);
  ocrButton = btn;
  return btn;
}

function positionButton(video) {
  const btn = getOrCreateButton();
  const rect = video.getBoundingClientRect();

  btn.style.left = `${rect.left + 12}px`;
  btn.style.top = `${rect.top + 12}px`;
  btn.style.display = "block";
}

function hideButton() {
  if (ocrButton) ocrButton.style.display = "none";
}

async function onButtonClick() {
  if (!activeVideo || processing) return;

  const btn = getOrCreateButton();
  btn.textContent = "…";
  btn.style.opacity = "0.6";
  btn.style.pointerEvents = "none";
  processing = true;

  try {
    await runOcr(activeVideo);
  } finally {
    processing = false;
    btn.textContent = "OCR";
    btn.style.opacity = "1";
    btn.style.pointerEvents = "auto";
  }
}

document.addEventListener(
  "pause",
  (event) => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement)) return;

    activeVideo = video;
    clearOverlay();
    positionButton(video);
  },
  true,
);

document.addEventListener(
  "play",
  (event) => {
    if (!(event.target instanceof HTMLVideoElement)) return;
    activeVideo = null;
    clearOverlay();
    hideButton();
  },
  true,
);

document.addEventListener(
  "seeked",
  (event) => {
    if (!(event.target instanceof HTMLVideoElement)) return;
    clearOverlay();
  },
  true,
);

window.addEventListener(
  "resize",
  () => {
    if (activeVideo) positionButton(activeVideo);
    syncOverlay();
  },
  true,
);

window.addEventListener(
  "scroll",
  () => {
    if (activeVideo) positionButton(activeVideo);
    syncOverlay();
  },
  true,
);

async function runOcr(video) {
  const frame = captureFrame(video);
  if (!frame) {
    console.error("[VideoOCR] frame capture failed.");
    return;
  }

  const response = await sendMessage({ type: "ocrFrame", imageBase64: frame });
  if (!response?.ok) {
    console.error("[VideoOCR]", response?.error);
    return;
  }

  const words = response.words ?? [];
  if (!words.length) {
    return;
  }

  renderOverlay(video, words);
}

function captureFrame(video) {
  const { videoWidth: w, videoHeight: h } = video;
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
}

function renderOverlay(video, words) {
  clearOverlay();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: "fixed",
    zIndex: "2147483646", // just below the button
    pointerEvents: "none",
    userSelect: "none",
    left: "0",
    top: "0",
  });

  for (const { text, box } of words) {
    overlay.appendChild(createWordSpan(text, box));
  }

  document.body.appendChild(overlay);
  activeOverlay = overlay;
  syncOverlay(video);
}

function createWordSpan(text, box) {
  const span = document.createElement("span");
  span.textContent = text;
  span.dataset.ocrLeft = box.left;
  span.dataset.ocrTop = box.top;
  span.dataset.ocrWidth = box.width;
  span.dataset.ocrHeight = box.height;

  Object.assign(span.style, {
    position: "absolute",
    whiteSpace: "pre",
    overflow: "hidden",
    pointerEvents: "auto",
    userSelect: "text",
    webkitUserSelect: "text",
    cursor: "text",
    lineBreak: "anywhere",
    color: "rgba(255,255,255,0.92)",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: "2px",
    padding: "0 1px",
    boxSizing: "border-box",
  });

  return span;
}

function syncOverlay(video) {
  if (!activeOverlay) return;
  const vid = video || activeVideo;
  if (!vid) return;

  const rect = getVideoRect(vid);

  Object.assign(activeOverlay.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });

  const scaleX = rect.width / rect.sourceWidth;
  const scaleY = rect.height / rect.sourceHeight;

  for (const span of activeOverlay.children) {
    const left = Number(span.dataset.ocrLeft) * scaleX;
    const top = Number(span.dataset.ocrTop) * scaleY;
    const width = Number(span.dataset.ocrWidth) * scaleX;
    const height = Number(span.dataset.ocrHeight) * scaleY;
    const fs = `${Math.max(8, Math.min(height * 0.82, 26))}px`;

    Object.assign(span.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
      fontSize: fs,
      lineHeight: fs,
    });
  }
}

function getVideoRect(video) {
  const bounds = video.getBoundingClientRect();
  const sourceWidth = video.videoWidth || bounds.width;
  const sourceHeight = video.videoHeight || bounds.height;
  const objectFit = getComputedStyle(video).objectFit || "contain";

  if (objectFit === "fill") {
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      sourceWidth,
      sourceHeight,
    };
  }

  const sourceRatio = sourceWidth / sourceHeight;
  const boundsRatio = bounds.width / bounds.height;
  let width, height;

  if (objectFit === "cover") {
    if (sourceRatio > boundsRatio) {
      height = bounds.height;
      width = height * sourceRatio;
    } else {
      width = bounds.width;
      height = width / sourceRatio;
    }
  } else {
    if (sourceRatio > boundsRatio) {
      width = bounds.width;
      height = width / sourceRatio;
    } else {
      height = bounds.height;
      width = height * sourceRatio;
    }
  }

  return {
    left: bounds.left + (bounds.width - width) / 2,
    top: bounds.top + (bounds.height - height) / 2,
    width,
    height,
    sourceWidth,
    sourceHeight,
  };
}

function clearOverlay() {
  activeOverlay?.remove();
  activeOverlay = null;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[VideoOCR] runtime error:",
          chrome.runtime.lastError.message,
        );
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}
