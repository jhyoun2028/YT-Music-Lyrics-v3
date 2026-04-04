const STATE_KEY = "aml_enabled";
const toggle = document.getElementById("toggle");
const status = document.getElementById("status");

function updateUI(on) {
  toggle.checked = on;
  status.textContent = on ? "Active on YouTube Music" : "Paused";
}

chrome.storage.local.get([STATE_KEY], (result) => {
  updateUI(result[STATE_KEY] !== false);
});

toggle.addEventListener("change", async () => {
  const on = toggle.checked;
  await chrome.storage.local.set({ [STATE_KEY]: on });
  updateUI(on);

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "AML_TOGGLE", enabled: on }).catch(() => {
      status.textContent = "Reload YouTube Music tab";
    });
  }
});
