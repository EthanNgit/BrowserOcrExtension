document.addEventListener("DOMContentLoaded", async () => {
  const keyInput = document.getElementById("vision-key");
  const saveButton = document.getElementById("save-key");
  const status = document.getElementById("status");

  const { visionApiKey } = await chrome.storage.local.get("visionApiKey");
  keyInput.value = visionApiKey || "";

  saveButton.addEventListener("click", async () => {
    const visionKey = keyInput.value.trim();
    await chrome.storage.local.set({ visionApiKey: visionKey });
    status.textContent = visionKey ? "Key saved." : "Key cleared.";
  });
});
