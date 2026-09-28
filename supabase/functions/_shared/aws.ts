/**
 * Asking AWS Rekognition whether an image is safe (spec 13.1 #3; roadmap M2.5).
 *
 * Signed by hand rather than with the AWS SDK. The SDK is several megabytes of JavaScript for one
 * call, and an edge function is charged by how long it takes to wake up - Signature Version 4 is
 * about sixty lines and has not changed since 2012.
 *
 * The key pair belongs to an AWS user that can do exactly one family of things (read Rekognition)
 * and nothing else: no storage, no billing, no ability to create anything. If it leaked, the worst
 * an attacker could do is ask Amazon to look at their own pictures on our bill.
 *
 * The image is sent as bytes in the request, never by handing AWS a link to our storage, so no
 * part of our bucket has to be reachable by anyone outside.
 */
const REGION = "us-east-1";
const SERVICE = "rekognition";
const HOST = `${SERVICE}.${REGION}.amazonaws.com`;

const encoder = new TextEncoder();

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return new Uint8Array(signature);
}

/** The four-step key derivation SigV4 uses so a signing key is scoped to one day, region and service. */
async function signingKey(secret: string, date: string): Promise<Uint8Array> {
  let key = encoder.encode(`AWS4${secret}`);
  for (const part of [date, REGION, SERVICE, "aws4_request"]) {
    key = await hmac(key, part);
  }
  return key;
}

export type ModerationLabel = { name: string; confidence: number };

/**
 * Returns the labels Rekognition saw, or throws.
 *
 * It THROWS rather than returning an empty list when anything goes wrong, and that distinction is
 * the whole safety property: an empty list means "AWS looked and saw nothing", which makes an
 * image visible. A failure must never be able to arrive at the same answer as a clean scan.
 */
export async function detectModerationLabels(
  image: Uint8Array,
  credentials: { accessKeyId: string; secretAccessKey: string },
  minConfidence: number,
): Promise<ModerationLabel[]> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);

  const body = JSON.stringify({
    Image: { Bytes: base64(image) },
    MinConfidence: minConfidence,
  });
  const bodyHash = await sha256Hex(body);
  const target = "RekognitionService.DetectModerationLabels";

  const canonical = [
    "POST",
    "/",
    "",
    `content-type:application/x-amz-json-1.1`,
    `host:${HOST}`,
    `x-amz-date:${amzDate}`,
    `x-amz-target:${target}`,
    "",
    "content-type;host;x-amz-date;x-amz-target",
    bodyHash,
  ].join("\n");

  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonical)].join("\n");
  const signature = hex(await hmac(await signingKey(credentials.secretAccessKey, date), toSign));

  const response = await fetch(`https://${HOST}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": target,
      "X-Amz-Date": amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
        `SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=${signature}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Rekognition refused: ${response.status} ${await response.text()}`);
  }

  const seen = await response.json();
  const labels = Array.isArray(seen?.ModerationLabels) ? seen.ModerationLabels : null;
  // A reply we cannot read is not a clean scan. Throwing is the only honest answer.
  if (labels === null) throw new Error("Rekognition replied in a shape we do not understand");

  return labels.map((l: { Name?: string; Confidence?: number }) => ({
    name: String(l.Name ?? ""),
    confidence: Number(l.Confidence ?? 0),
  }));
}

/** Base64 without pulling in a library, and without blowing the stack on a 10 MB photo. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
