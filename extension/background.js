// Kleit's browser extension (roadmap M9.1; spec 4.1 #3; design pack S108). Clipping from a
// computer, the simplest way that is honest: the extension never reads the page itself and never
// holds a sign-in. It hands the page's address - and, on a right-click, the picture's - to the
// app's own Clip a link screen, where the server reads the page, the person picks and confirms,
// and the same screening runs as for every clip. One permission (the active tab's address when
// the button is clicked) and the context menu; nothing runs on store pages.
//
// Edge runs the same package: it takes Chrome extensions as they are.

const DEFAULT_SITE = "https://kleit-test.kleitapp-team.workers.dev";

async function site() {
  try {
    const { site } = await chrome.storage.sync.get("site");
    return typeof site === "string" && /^https:\/\//.test(site)
      ? site.replace(/\/+$/, "")
      : DEFAULT_SITE;
  } catch {
    return DEFAULT_SITE;
  }
}

async function clip(pageUrl, imageUrl) {
  if (!pageUrl || !/^https?:\/\//.test(pageUrl)) return;
  const base = await site();
  const target = new URL("/add/link", base);
  target.searchParams.set("url", pageUrl);
  if (imageUrl && /^https?:\/\//.test(imageUrl)) target.searchParams.set("image", imageUrl);
  await chrome.tabs.create({ url: target.toString() });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "kleit-clip-page",
    title: "Clip this page to Kleit",
    contexts: ["page", "link", "selection"],
  });
  chrome.contextMenus.create({
    id: "kleit-clip-image",
    title: "Clip this picture to Kleit",
    contexts: ["image"],
  });
});

chrome.action.onClicked.addListener((tab) => {
  void clip(tab?.url);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "kleit-clip-image") void clip(info.pageUrl ?? tab?.url, info.srcUrl);
  else if (info.menuItemId === "kleit-clip-page") void clip(info.pageUrl ?? tab?.url);
});
