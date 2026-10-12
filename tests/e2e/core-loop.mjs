/**
 * The core loop, clicked through on the deployed test site (roadmap M3.9; technical pack §7.3):
 *
 *   sign up → build a set → send → open the link signed out → vote as a guest → sign up from the link
 *
 * If this breaks, everything breaks, so it runs on every push once the new bundle is live.
 *
 * One honest limit: a machine has no mailbox, so the 6-digit code is the one step it cannot
 * click. The session is minted the way a code would mint it (an admin-generated one-time token,
 * verified with the public client), and the run picks the flow up at the first screen after the
 * code: the username. Every other step is the real screen, tapped.
 *
 * It uses one fixed account, `e2e-core-loop@test.kleit`, and never deletes anything: a stored
 * photo must keep its clip record (decision 103), so the run's sets and polls are soft-deleted at
 * the end and the pieces stay in that account's closet.
 *
 *   KLEIT_TEST_SITE  the site (default: the test site)
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY  to mint the session
 *   KLEIT_CHROMIUM   optional path to a Chromium binary
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// Accessibility (spec 21; design pack 8.3; technical pack §7 #9): axe over the real screens as the
// loop passes them. Serious and critical WCAG 2.2 AA problems fail the run; the rest are printed.
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
async function a11y(pg, label) {
  try {
    // A sheet on its way out is still in the tree for its fade: axe once sampled the picker's
    // button mid-fade and called the colour contrast serious. The screen is checked at rest.
    await pg
      .locator('[role="dialog"]')
      .first()
      .waitFor({ state: "hidden", timeout: 3000 })
      .catch(() => undefined);
    await pg.waitForTimeout(400);
    // The whole page in one tall viewport for the run, the way a phone sees it as it scrolls: at
    // 844 px the sticky tab bar covers whatever happens to sit in the bottom band of the first
    // screen, and axe counts a covered button as too small to tap.
    const tall = Math.min(await pg.evaluate(() => document.documentElement.scrollHeight), 4000);
    await pg.setViewportSize({ width: 390, height: Math.max(844, tall) });
    // Evaluated through the browser's debugging channel, not as a <script> tag: the public
    // pages carry a Content Security Policy that allows no script but their own, and axe is not
    // one of theirs (that the policy blocks a tag is the point of it; the vote below proves the
    // page's own script still runs).
    await pg.evaluate(AXE);
    const found = await pg.evaluate(async () => {
      const r = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        count: v.nodes.length,
        where: v.nodes
          .slice(0, 2)
          .map((x) => `${x.target.join(" ")} ${x.html.slice(0, 90)}`)
          .join(" | "),
      }));
    });
    await pg.setViewportSize({ width: 390, height: 844 });
    const bad = found.filter((v) => v.impact === "serious" || v.impact === "critical");
    const words = found.map((v) => `${v.impact} ${v.id}×${v.count} (${v.where})`).join("; ");
    check(
      bad.length === 0,
      `a11y: ${label} has no serious or critical WCAG problems`,
      words || "clean",
    );
  } catch (problem) {
    check(
      false,
      `a11y: ${label} could not be checked`,
      problem instanceof Error ? problem.message : String(problem),
    );
  }
}

const SITE = process.env.KLEIT_TEST_SITE ?? "https://kleit-test.kleitapp-team.workers.dev";
const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error("SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY are required");
  process.exit(2);
}
const EMAIL = "e2e-core-loop@test.kleit";
const USERNAME = "e2ecoreloop";
const REF = new URL(URL_).hostname.split(".")[0];
const STORAGE_KEY = `sb-${REF}-auth-token`;

let n = 0;
let failed = 0;
function check(ok, what, detail = "") {
  n += 1;
  console.log(`${ok ? "ok" : "not ok"} ${n} - ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// A small PNG, made here so the run carries no fixture: 96×96, two flat colour blocks.
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(w = 96, h = 96) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const top = y < h / 2;
      raw[o] = top ? 214 : 30;
      raw[o + 1] = top ? 120 : 60;
      raw[o + 2] = top ? 60 : 140;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The session, minted the way the code screen mints it.
// ---------------------------------------------------------------------------
const admin = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function mintSession() {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = list?.users.find((u) => u.email === EMAIL) ?? null;
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    user = data.user;
  }
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const pub = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: vErr } = await pub.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (vErr || !verified.session) throw new Error(`verifyOtp: ${vErr?.message ?? "no session"}`);
  return { user, session: verified.session };
}

async function tidyUp(userId) {
  const stamp = new Date().toISOString();
  await admin
    .from("polls")
    .update({ deleted_at: stamp })
    .eq("owner_id", userId)
    .is("deleted_at", null);
  await admin
    .from("sets")
    .update({ deleted_at: stamp })
    .eq("owner_id", userId)
    .is("deleted_at", null);
}

// ---------------------------------------------------------------------------
const { user, session } = await mintSession();
await tidyUp(user.id);

const browser = await chromium.launch(
  process.env.KLEIT_CHROMIUM ? { executablePath: process.env.KLEIT_CHROMIUM } : {},
);
const owner = await browser.newContext({ viewport: { width: 390, height: 844 } });
await owner.addInitScript(
  ([key, value]) => {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
  },
  [STORAGE_KEY, JSON.stringify(session)],
);
const page = await owner.newPage();
page.setDefaultTimeout(20_000);

try {
  // 1. Sign up: the first screen after the code.
  await page.goto(`${SITE}/`);
  // Either the username screen (a brand-new account) or Home with its Create tab.
  await Promise.race([
    page.waitForURL(/\/join\/username/, { timeout: 20_000 }),
    page.getByRole("button", { name: "Create" }).waitFor({ timeout: 20_000 }),
  ]);
  if (new URL(page.url()).pathname.startsWith("/join/username")) {
    await page.getByLabel("Username").fill(USERNAME);
    const box = page.getByRole("checkbox");
    if (await box.count()) await box.first().check();
    await page.getByRole("button", { name: "Next" }).click();
    await page.waitForURL(/\/join\/name/);
    await page.getByLabel("Display name").fill("Core Loop");
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForURL((u) => new URL(u).pathname === "/");
    check(true, "sign up: username and name claimed, landed on Home");
  } else {
    check(true, "sign up: the account already has its username; landed on Home");
  }
  await a11y(page, "Home");

  // 2. A piece of your own, through the real screen (uploaded, screened, in the closet).
  await page.goto(`${SITE}/add/photo`);
  await page.getByRole("button", { name: "Choose a photo" }).waitFor();
  await a11y(page, "Add a photo");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "piece.png", mimeType: "image/png", buffer: makePng() });
  await page.getByRole("button", { name: "Add it" }).click();
  const verdict = page
    .getByRole("status")
    .filter({ hasText: /Added|needs a person|can't be added|Still checking/ });
  await verdict.first().waitFor({ timeout: 90_000 });
  const verdictText = (await verdict.first().innerText()).trim();
  check(/^Added/.test(verdictText), "photo: uploaded and screened clean", verdictText);

  // 3. Build: Create → Quick set → tap a slot → pick the piece from the closet → caption → Send.
  async function buildOne(caption) {
    await page.goto(`${SITE}/`);
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("button", { name: /Quick set/ }).click();
    await page.waitForURL(/\/set\/[0-9a-f-]+\/edit/);
    const setId = page.url().match(/\/set\/([0-9a-f-]+)\/edit/)[1];
    await page.getByRole("button", { name: /Slot 1, empty/ }).click();
    await page.getByRole("tab", { name: "Closet" }).click();
    await page.getByRole("dialog").locator("li button").first().click();
    await page.getByRole("button", { name: /Slot 1:/ }).waitFor();
    if (caption === "core loop one") await a11y(page, "the quick builder");
    await page.getByLabel("Caption or question").fill(caption);
    await wait(1500); // the debounced autosave
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForURL(/\/send$/);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const link = page.getByText(/\/s\/[A-Za-z0-9]{8,32}/);
    await link.waitFor();
    const code = (await link.innerText()).match(/\/s\/([A-Za-z0-9]{8,32})/)[1];
    return { setId, code };
  }
  const first = await buildOne("core loop one");
  check(
    !!first.code,
    "build and send: the first set is published with a share link",
    `/s/${first.code}`,
  );
  const second = await buildOne("core loop two");
  check(!!second.code && second.code !== first.code, "build and send: a second set, its own link");

  // 4. A poll of the two, for the guest to vote on.
  await page.goto(`${SITE}/poll/new`);
  await page.getByPlaceholder("Which one for Friday?").fill("Which one?");
  // The sets are the pressable rows in the list; the duration chips below are pressable too.
  const setButtons = page.locator("ul button[aria-pressed]");
  await setButtons.first().waitFor();
  await setButtons.nth(0).click();
  await setButtons.nth(1).click();
  await page.getByRole("button", { name: "Make the poll" }).click();
  await page.waitForURL(/\/poll\/[0-9a-f-]+$/);
  const pollLink = page.getByText(/\/p\/[A-Za-z0-9]{8,32}/);
  await pollLink.waitFor();
  const pollCode = (await pollLink.innerText()).match(/\/p\/([A-Za-z0-9]{8,32})/)[1];
  check(!!pollCode, "poll: made from the two sets", `/p/${pollCode}`);

  // 5. Signed out: the shared set, as a stranger with no account.
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gp = await guest.newPage();
  gp.setDefaultTimeout(20_000);
  const t0 = Date.now();
  const res = await gp.goto(`${SITE}/s/${first.code}`);
  const elapsed = Date.now() - t0;
  check(
    res?.status() === 200 && res.headers()["x-kleit-surface"] === "share-worker",
    "signed out: the share Worker answers the link",
    `${res?.status()} in ${elapsed} ms`,
  );
  const shared = await gp.innerText("body");
  check(
    /core loop one/.test(shared) && /Sign up/.test(shared),
    "signed out: the set and the sign-up card are on the page",
    shared.replace(/\s+/g, " ").slice(0, 200),
  );
  check(elapsed < 2500, "signed out: the page arrives in under 2.5 s", `${elapsed} ms`);
  await a11y(gp, "the share page (signed out)");
  // CL30: the chat picture. Drawn after publish by the server; give it a moment, then read the
  // tag and fetch the file it points at.
  let ogImage = null;
  for (let tries = 0; tries < 10 && !ogImage; tries++) {
    await gp.goto(`${SITE}/s/${first.code}`);
    ogImage = await gp.getAttribute('meta[property="og:image"]', "content").catch(() => null);
    if (!ogImage) await wait(2000);
  }
  const picture = ogImage ? await fetch(ogImage) : null;
  check(
    !!picture &&
      picture.status === 200 &&
      /^image\/jpeg/.test(picture.headers.get("content-type") ?? ""),
    "signed out: the link carries a chat picture (og:image) that really exists",
    ogImage
      ? `${picture?.status} ${picture?.headers.get("content-type")} ${ogImage.slice(-30)}`
      : "no og:image tag",
  );

  // 6. Guest vote: two taps, then the bars, then the sign-up card; a repeat tap is refused.
  await gp.goto(`${SITE}/p/${pollCode}`);
  const before = await gp.innerText("body");
  check(
    /One vote per device/.test(before) && /How we handle votes/.test(before),
    "guest vote: the privacy line and 'one vote per device' show BEFORE the first tap",
  );
  await a11y(gp, "the poll page (signed out)");
  const guestConsole = [];
  gp.on("console", (m) => guestConsole.push(`${m.type()}: ${m.text()}`));
  gp.on("pageerror", (e) => guestConsole.push(`pageerror: ${e.message}`));
  await gp.locator("button.vote").first().click();
  await Promise.race([
    gp.locator(".option.mine").waitFor({ timeout: 45_000 }),
    gp.locator("#notice:not([hidden])").waitFor({ timeout: 45_000 }),
  ]);
  if (!(await gp.locator(".option.mine").count())) {
    const said = await gp.innerText("#notice");
    throw new Error(
      `the vote did not land: "${said}" · console: ${guestConsole.slice(-5).join(" | ")}`,
    );
  }
  const after = await gp.innerText("body");
  check(/Your vote/.test(after) && /%/.test(after), "guest vote: the bars appear after the vote");
  check(
    /Send one back/.test(after) && /Sign up/.test(after),
    "guest vote: the sign-up card comes after the results (decision 88)",
  );
  await gp.locator(".option.mine button.vote").click();
  await gp.locator("#notice:not([hidden])").waitFor({ timeout: 30_000 });
  const notice = await gp.innerText("#notice");
  check(
    /already voted from this device/i.test(notice),
    "guest vote: a second vote from the same device is refused with the friendly wording",
    notice,
  );

  // 7. Sign up from the link.
  await gp.getByRole("link", { name: "Sign up" }).first().click();
  await gp.waitForURL(/\/welcome/);
  // The app shell boots after the launch check; wait for the screen's words, not the URL.
  await gp
    .getByText(/Get started|Build an outfit/)
    .first()
    .waitFor({ timeout: 20_000 });
  const welcome = await gp.innerText("body");
  check(
    /Get started|Build an outfit/.test(welcome),
    "sign up from the link: the Welcome screen opens",
    welcome.replace(/\s+/g, " ").slice(0, 120),
  );
  // 7b. …and once signed in, the person lands back on the poll they came from (spec 8.2 #2).
  //     The sign-in itself is stood in for by the owner's session (a code needs a mailbox).
  await gp.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify(session)],
  );
  await gp.goto(`${SITE}/`);
  await gp.waitForURL(/\/poll\/[0-9a-f-]+$/, { timeout: 20_000 }).catch(() => undefined);
  check(
    /\/poll\/[0-9a-f-]+$/.test(gp.url()),
    "sign up from the link: afterwards the person is back on the poll, not on Home",
    new URL(gp.url()).pathname,
  );
  await gp.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);

  // 8. The owner sees totals, never names, and the poll knows about the guest.
  await page.reload();
  await page
    .getByText(/1 vote/)
    .first()
    .waitFor({ timeout: 20_000 });
  const results = await page.innerText("body");
  check(
    /Totals only, never names/.test(results) && /1 vote/.test(results),
    "owner: results show the guest's vote as a total",
  );
  await guest.close();

  // 9. Download my data (S25): the ZIP is made for this account, the link opens, and the file is
  //    a real ZIP that carries the profile and the sets built above.
  const exportAnswer = await fetch(`${URL_}/functions/v1/export-data`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: ANON,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const exported = exportAnswer.ok ? await exportAnswer.json() : null;
  check(
    !!exported?.url,
    "download my data: the server made the file",
    `http ${exportAnswer.status}`,
  );
  if (exported?.url) {
    const zipAnswer = await fetch(exported.url);
    const zipBytes = new Uint8Array(await zipAnswer.arrayBuffer());
    const isZip = zipBytes[0] === 0x50 && zipBytes[1] === 0x4b;
    const text = new TextDecoder("latin1").decode(zipBytes);
    check(
      zipAnswer.ok && isZip && zipBytes.length > 200,
      "download my data: the link opens a real ZIP",
      `${zipBytes.length} bytes`,
    );
    check(
      /profile\.json/.test(text) && /sets\.json/.test(text) && /README\.txt/.test(text),
      "download my data: the ZIP carries profile.json, sets.json and a README",
    );
  }

  // 10. Recently deleted (S26): delete the second set from its own page, find it in the bin,
  //     bring it back, then delete one set for good from the bin.
  await page.goto(`${SITE}/set/${second.setId}`);
  await page.getByRole("button", { name: "More options" }).waitFor();
  await a11y(page, "the set page");
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete the set" }).click();
  await page.waitForURL(/\/you$/);
  await page.goto(`${SITE}/you/deleted`);
  const restoreButtons = page.getByRole("button", { name: "Restore" });
  await restoreButtons.first().waitFor();
  const inBin = await restoreButtons.count();
  const binText = await page.innerText("body");
  check(
    inBin >= 1 && /days left|Goes tonight/.test(binText),
    "recently deleted: the deleted set is in the bin with its days left",
    `${inBin} in the bin`,
  );
  // The newest deletion is first: that is the set just deleted.
  await restoreButtons.first().click();
  await page.getByText("Restored. It's back with your sets.").waitFor();
  const { data: restoredRow } = await admin
    .from("sets")
    .select("deleted_at")
    .eq("id", second.setId)
    .maybeSingle();
  check(
    restoredRow?.deleted_at === null && (await restoreButtons.count()) === inBin - 1,
    "recently deleted: Restore puts the set back",
  );
  if (inBin >= 2) {
    const { data: binRows } = await admin
      .from("sets")
      .select("id")
      .eq("owner_id", user.id)
      .not("deleted_at", "is", null);
    const before = binRows?.length ?? 0;
    await page.getByRole("button", { name: "Delete now" }).first().click();
    await page.getByRole("button", { name: "Delete for good" }).click();
    await wait(1500);
    const { data: binAfter } = await admin
      .from("sets")
      .select("id")
      .eq("owner_id", user.id)
      .not("deleted_at", "is", null);
    check(
      (binAfter?.length ?? 0) === before - 1 && (await restoreButtons.count()) === inBin - 2,
      "recently deleted: Delete now destroys the set for good",
      `${before} → ${binAfter?.length ?? 0} in the bin`,
    );
  }
  // 11. Remix (spec 7.4): the first set, remixed from its own page, opens as a new draft in
  //     the editor with the same piece on it.
  await page.goto(`${SITE}/set/${first.setId}`);
  await page.getByRole("button", { name: "Remix", exact: true }).click();
  await page.waitForURL(/\/set\/[0-9a-f-]+\/(edit|canvas)$/, { timeout: 20_000 });
  const remixId = page.url().match(/\/set\/([0-9a-f-]+)\//)?.[1] ?? "";
  const { data: remixRow } = await admin
    .from("sets")
    .select("status, owner_id")
    .eq("id", remixId)
    .maybeSingle();
  const { data: remixPieces } = await admin.from("set_items").select("id").eq("set_id", remixId);
  check(
    remixId !== "" &&
      remixId !== first.setId &&
      remixRow?.status === "draft" &&
      remixRow.owner_id === user.id,
    "remix: a new draft of the remixer's opens in the editor",
    remixId.slice(0, 8),
  );
  check(
    (remixPieces ?? []).length === 1,
    "remix: the piece came along",
    `${(remixPieces ?? []).length} piece(s)`,
  );
} catch (error) {
  check(false, `the loop stopped: ${error instanceof Error ? error.message : String(error)}`);
  try {
    for (const ctx of browser.contexts()) {
      for (const [i, pg] of ctx.pages().entries()) {
        await pg.screenshot({
          path: `core-loop-failure-${ctx === owner ? "owner" : "guest"}-${i}.png`,
          fullPage: true,
        });
      }
    }
    await page.screenshot({ path: "core-loop-failure.png", fullPage: true });
    console.log("# screenshot: core-loop-failure.png at " + page.url());
  } catch {
    /* nothing to show */
  }
} finally {
  await browser.close();
  await tidyUp(user.id);
}

console.log(`1..${n}`);
console.log(
  failed === 0
    ? `# core loop: all ${n} checks passed`
    : `# core loop: ${failed} of ${n} checks FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
