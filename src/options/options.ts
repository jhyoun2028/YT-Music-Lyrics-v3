function init(): void {
  const toggle = document.getElementById("aml-enabled") as HTMLInputElement;

  if (!toggle) return;

  chrome.storage.local.get({ amlEnabled: true }, (items) => {
    const enabled = Boolean(items.amlEnabled);
    toggle.checked = enabled;
    updateStatus(enabled);
  });

  toggle.addEventListener("change", () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ amlEnabled: enabled });
    updateStatus(enabled);

    chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
      tabs.forEach((tab) => {
        if (tab.id != null) {
          chrome.tabs.sendMessage(tab.id, {
            type: "AML_TOGGLE",
            enabled: enabled,
          }).catch(() => {});
        }
      });
    });
  });
}

function updateStatus(enabled: boolean): void {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = enabled ? "Overlay active on YouTube Music" : "Overlay disabled";
  }
}

document.addEventListener("DOMContentLoaded", init);
