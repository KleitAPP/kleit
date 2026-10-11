// The one setting: which Kleit the extension opens (the test site until kleit.app exists).
const DEFAULT_SITE = "https://kleit-test.kleitapp-team.workers.dev";
const field = document.getElementById("site");
const saved = document.getElementById("saved");

chrome.storage.sync.get("site").then(({ site }) => {
  field.value = typeof site === "string" ? site : DEFAULT_SITE;
});

document.getElementById("save").addEventListener("click", async () => {
  const value = field.value.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/\s]+$/.test(value)) {
    saved.textContent = "That needs to be an https address with nothing after the site name.";
    return;
  }
  await chrome.storage.sync.set({ site: value });
  saved.textContent = "Saved.";
});
