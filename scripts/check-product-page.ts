/**
 * Proves the store-page reader and the two pure guards under it, with no network (roadmap M2.4).
 *
 *   - readProductPage: four shapes of page - Open Graph only; JSON-LD inside a @graph with an
 *     offers list; a European comma price with relative image paths; and a page that is not a
 *     product at all, which must come back empty rather than inventing one.
 *   - toCents: the price strings stores actually print.
 *   - cleanSourceUrl: tracking codes go, the product path stays (spec 4.2 #4).
 *   - isPrivateAddress: every range a server must never be pointed at (security plan #17).
 *
 * Run: bun scripts/check-product-page.ts   (CI runs it on every push)
 */
import {
  readProductPage,
  toCents,
  cleanSourceUrl,
  looksLikeAShell,
  stockOf,
} from "../supabase/functions/_shared/product-page.ts";
import {
  isPrivateAddress,
  parsePublicUrl,
  SafeFetchError,
} from "../supabase/functions/_shared/safe-fetch.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ← ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

// 1. Open Graph only, attributes in both orders, entities in the title.
const og = readProductPage(
  `<html><head>
    <title>Fallback title | Store</title>
    <meta content="Linen Shirt &amp; Co" property="og:title">
    <meta property="og:site_name" content="Nice Store" />
    <meta property="og:image" content="https://cdn.nice.example/a.jpg">
    <meta property="og:image" content="https://cdn.nice.example/b.jpg">
    <meta property="og:image" content="https://cdn.nice.example/a.jpg">
    <meta property="product:price:amount" content="49.50">
    <meta property="product:price:currency" content="usd">
    <link rel="canonical" href="/p/linen-shirt?utm_source=x">
  </head><body></body></html>`,
  new URL("https://www.nice.example/p/linen-shirt?variant=2&utm_source=insta"),
);
check("OG: title, decoded", og.title === "Linen Shirt & Co", og);
check("OG: price to cents", og.priceCents === 4950, og);
check("OG: currency upper-cased", og.currency === "USD", og);
check("OG: site name", og.storeName === "Nice Store", og);
check(
  "OG: two images, no duplicate",
  og.images.length === 2 && og.images[0] === "https://cdn.nice.example/a.jpg",
  og,
);
check(
  "OG: canonical made absolute",
  og.canonical === "https://www.nice.example/p/linen-shirt?utm_source=x",
  og,
);

// 2. JSON-LD in a @graph, offers as a list, image objects, brand as an object. Wins over a stale og:title.
const ld = readProductPage(
  `<html><head>
    <meta property="og:title" content="Old cached title">
    <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","name":"x"},
      {"@type":"Product","name":"Wool Coat","brand":{"@type":"Brand","name":"Coatmaker"},
       "image":[{"@type":"ImageObject","url":"https://img.coat.example/1.jpg"},"https://img.coat.example/2.jpg"],
       "offers":[{"@type":"Offer","price":"1299.00","priceCurrency":"USD"}]}
    ]}
    </script>
  </head></html>`,
  new URL("https://coat.example/coats/wool"),
);
check("LD: name beats a stale og:title", ld.title === "Wool Coat", ld);
check("LD: price from the first offer", ld.priceCents === 129900 && ld.currency === "USD", ld);
check(
  "LD: brand as the store name when there is no og:site_name",
  ld.storeName === "Coatmaker",
  ld,
);
check(
  "LD: images from objects and strings",
  ld.images.join(",") === "https://img.coat.example/1.jpg,https://img.coat.example/2.jpg",
  ld,
);

// 3. Comma decimal, relative image, itemprop price.
const eu = readProductPage(
  `<html><head><meta name="twitter:title" content="Robe Longue">
   <span itemprop="price" content="89,99"></span><meta itemprop="priceCurrency" content="EUR">
   <img itemprop="image" src="/media/robe.jpg"></head></html>`,
  new URL("https://mode.example/fr/robe"),
);
check("EU: comma decimal", eu.priceCents === 8999 && eu.currency === "EUR", eu);
check(
  "EU: relative image made absolute",
  eu.images[0] === "https://mode.example/media/robe.jpg",
  eu,
);
check("EU: twitter title as the fallback", eu.title === "Robe Longue", eu);

// 4. Not a product.
const blog = readProductPage(
  `<html><head><title>Ten ways to wear linen</title></head><body><p>$40 is cheap</p></body></html>`,
  new URL("https://blog.example/linen"),
);
check(
  "Blog: title only, no price invented from the body",
  blog.title === "Ten ways to wear linen" &&
    blog.priceCents === null &&
    blog.currency === null &&
    blog.images.length === 0,
  blog,
);

// 5. A ProductGroup whose price sits on the first variant, inside a priceSpecification (H&M's shape).
const group = readProductPage(
  `<html><head><script type="application/ld+json">
   {"@context":"https://schema.org","@type":"ProductGroup","name":"Satin Strappy Dress","brand":{"name":"H&M"},
    "hasVariant":[{"@type":"Product","name":"Satin Strappy Dress - Black","offers":{"@type":"Offer","url":"x",
      "priceCurrency":"USD","priceSpecification":{"@type":"UnitPriceSpecification","price":11.99,"priceCurrency":"USD"}}}]}
   </script></head></html>`,
  new URL("https://www2.hm.example/en_us/productpage.1312058001.html"),
);
check(
  "Group: price from the first variant's priceSpecification",
  group.priceCents === 1199 && group.currency === "USD",
  group,
);

// 6. A zero price in JSON-LD is not a price; the meta tag's real one wins (Free People's shape).
const zero = readProductPage(
  `<html><head><script type="application/ld+json">{"@type":"Product","name":"Slip","offers":{"@type":"Offer","price":0,"priceCurrency":"USD"}}</script>
   <meta property="product:price:amount" content="128.00"><meta property="product:price:currency" content="USD"></head></html>`,
  new URL("https://fp.example/shop/slip/"),
);
check("Zero: a zero price falls through to the next source", zero.priceCents === 12800, zero);

// 7. Stock (spec 4.8 #1): the words stores use, and how the offers are read.
check("stock: schema.org InStock as an address", stockOf("https://schema.org/InStock") === true);
check("stock: schema.org OutOfStock, http", stockOf("http://schema.org/OutOfStock") === false);
check("stock: a bare SoldOut", stockOf("SoldOut") === false);
check("stock: Open Graph instock / oos", stockOf("instock") === true && stockOf("oos") === false);
check("stock: 'out of stock' with spaces", stockOf("out of stock") === false);
check("stock: PreOrder is still for sale", stockOf("https://schema.org/PreOrder") === true);
check(
  "stock: an unknown word is no reading",
  stockOf("maybe") === null && stockOf(undefined) === null,
);
check(
  "stock: the pages above, which did not say, read null",
  og.available === null && ld.available === null && blog.available === null,
);
const sizes = readProductPage(
  `<html><head><script type="application/ld+json">{"@type":"Product","name":"Boots","offers":[
    {"@type":"Offer","price":"120","priceCurrency":"USD","availability":"https://schema.org/OutOfStock"},
    {"@type":"Offer","price":"120","priceCurrency":"USD","availability":"https://schema.org/InStock"}]}</script>
   <meta property="product:availability" content="oos"></head></html>`,
  new URL("https://boots.example/p/1"),
);
check(
  "stock: one size left is in stock, and the product block beats the stale og tag",
  sizes.available === true,
  sizes,
);
const gone = readProductPage(
  `<html><head><script type="application/ld+json">{"@type":"ProductGroup","name":"Dress","hasVariant":[
    {"@type":"Product","offers":{"@type":"Offer","price":"50","priceCurrency":"USD","availability":"http://schema.org/OutOfStock"}},
    {"@type":"Product","offers":{"@type":"Offer","price":"50","priceCurrency":"USD","availability":"http://schema.org/SoldOut"}}]}</script></head></html>`,
  new URL("https://dress.example/p/1"),
);
check("stock: every variant gone is sold out", gone.available === false, gone);
const ogOnly = readProductPage(
  `<html><head><meta property="og:title" content="Hat"><meta property="product:price:amount" content="20">
   <meta property="product:availability" content="out of stock"></head></html>`,
  new URL("https://hat.example/p/1"),
);
check(
  "stock: the Open Graph tag when there is no product block",
  ogOnly.available === false,
  ogOnly,
);
const micro = readProductPage(
  `<html><head><meta property="og:title" content="Belt"></head><body>
   <link itemprop="availability" href="http://schema.org/InStock"></body></html>`,
  new URL("https://belt.example/p/1"),
);
check("stock: the microdata link as the last source", micro.available === true, micro);

// 7. Shells and bot walls.
check(
  "Shell: a 2 KB page with a blank title is a shell",
  looksLikeAShell(
    "<html><head><title>&nbsp;</title><meta charset=utf-8></head><body></body></html>",
  ) === true,
);
check(
  "Shell: a big page with no meta at all is a shell",
  looksLikeAShell(
    "<html><head><title></title></head><body>" + "x".repeat(300000) + "</body></html>",
  ) === true,
);
check(
  "Shell: a real product page is not",
  looksLikeAShell(
    `<html><head><title>Wool Coat | Coats</title>${'<meta property="og:x" content="y">'.repeat(6)}</head><body>${"p".repeat(5000)}</body></html>`,
  ) === false,
);

// toCents
check("toCents: $1,299.00", toCents("$1,299.00") === 129900);
check("toCents: 49", toCents("49") === 4900);
check("toCents: 49,99 (comma decimal)", toCents("49,99") === 4999);
check("toCents: 1.299,00 (European thousands)", toCents("1.299,00") === 129900);
check("toCents: nonsense is null", toCents("call for price") === null);
check("toCents: absurd is null", toCents("99999999") === null);

// cleanSourceUrl
check(
  "cleanSourceUrl drops tracking and keeps the product",
  cleanSourceUrl(
    new URL("https://shop.example/p/1?color=red&utm_source=ig&fbclid=abc&gclid=1#top"),
  ) === "https://shop.example/p/1?color=red",
);

// isPrivateAddress
for (const ip of [
  "127.0.0.1",
  "10.1.2.3",
  "172.16.0.9",
  "172.31.255.1",
  "192.168.1.1",
  "169.254.169.254",
  "0.0.0.0",
  "100.64.0.1",
  "224.0.0.1",
  "::1",
  "fe80::1",
  "fd00::1",
  "::ffff:127.0.0.1",
  "999.1.1.1",
  // The same addresses in the spellings the URL parser and a careful attacker use: the mapped
  // form written in hex, the old compatible form, NAT64, 6to4, a zone id, the whole of fe80::/10,
  // multicast, and a shape that is not an address at all.
  "::ffff:7f00:1",
  "::ffff:a9fe:a9fe",
  "::7f00:1",
  "::127.0.0.1",
  "64:ff9b::7f00:1",
  "64:ff9b::169.254.169.254",
  "2002:7f00:1::",
  "2002:a9fe:a9fe::",
  "fe80::1%eth0",
  "febf::1",
  "fc00::1",
  "ff02::1",
  "::",
  "::1:",
  "1:2:3:4:5:6:7:8:9",
]) {
  check(`private: ${ip}`, isPrivateAddress(ip) === true);
}
for (const ip of [
  "8.8.8.8",
  "104.16.0.1",
  "172.32.0.1",
  "2606:4700::1111",
  "::ffff:8.8.8.8",
  "::ffff:808:808",
  "2002:808:808::",
  "64:ff9b::808:808",
  "2001:db8::1",
]) {
  check(`public: ${ip}`, isPrivateAddress(ip) === false);
}

// parsePublicUrl
for (const bad of [
  "javascript:alert(1)",
  "file:///etc/passwd",
  "ftp://x.example/a",
  "https://user:pw@x.example/",
  "https://x.example:8080/",
  "http://localhost/",
  "http://a.localhost/",
  "not a url",
]) {
  let refused = false;
  try {
    parsePublicUrl(bad);
  } catch (e) {
    refused = e instanceof SafeFetchError;
  }
  check(`refused: ${bad}`, refused);
}
check(
  "accepted: an ordinary https address",
  parsePublicUrl("https://www.zara.com/us/en/x-p1.html").hostname === "www.zara.com",
);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nProduct page check passed");
