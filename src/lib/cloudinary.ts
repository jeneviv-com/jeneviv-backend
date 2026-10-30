import { createHash } from "node:crypto";
import { env } from "../env.js";

export interface SignUploadArgs {
  /** Optional Cloudinary folder. Restricted to a safe charset to avoid path tricks. */
  folder?: string;
  /** Cloudinary resource type. */
  resourceType?: "image" | "raw" | "video";
}

export interface SignedUploadParams {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  signature: string;
  resource_type: "image" | "raw" | "video";
  upload_url: string;
  folder?: string;
}

const FOLDER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_\-/]{0,80}$/;

function ensureConfigured(): {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
} {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary is not configured: CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET",
    );
  }
  return { cloudName, apiKey, apiSecret };
}

/**
 * Cloudinary signing: sort signed params alphabetically, join as `k=v&k2=v2`,
 * append api_secret, take sha1 hex digest.
 */
function sign(params: Record<string, string | number>, apiSecret: string): string {
  const ordered = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(`${ordered}${apiSecret}`).digest("hex");
}

export function signUpload(args: SignUploadArgs): SignedUploadParams {
  const { cloudName, apiKey, apiSecret } = ensureConfigured();
  const resourceType = args.resourceType ?? "image";

  if (args.folder !== undefined && !FOLDER_RE.test(args.folder)) {
    throw new Error("Invalid folder name");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signedParams: Record<string, string | number> = { timestamp };
  if (args.folder) signedParams.folder = args.folder;

  const signature = sign(signedParams, apiSecret);
  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;

  return {
    cloud_name: cloudName,
    api_key: apiKey,
    timestamp,
    signature,
    resource_type: resourceType,
    upload_url: uploadUrl,
    ...(args.folder ? { folder: args.folder } : {}),
  };
}

/**
 * True if `url` is an HTTPS Cloudinary delivery URL hosted on the configured cloud.
 * Only the canonical `res.cloudinary.com/<cloud>/...` shape is accepted: it is the
 * only host Cloudinary issues delivery URLs on, so anything else is a stored URL
 * we should not sign a delete for.
 */
export function isCloudinaryUrlOnOurCloud(url: string): boolean {
  const cloud = env.CLOUDINARY_CLOUD_NAME;
  if (!cloud) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password || parsed.port) return false;
  const host = parsed.hostname.toLowerCase();
  const cloudName = cloud.toLowerCase();
  if (host !== "res.cloudinary.com") return false;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() !== cloudName || segments.length < 3) {
    return false;
  }
  const resourceType = segments[1];
  if (resourceType !== "image" && resourceType !== "raw" && resourceType !== "video") {
    return false;
  }
  return segments.length >= 3;
}

/**
 * Cloudinary public id for a delivery URL on our cloud, without the extension:
 * https://res.cloudinary.com/<cloud>/image/upload/v123/jeneviv/groups/abc.png -> jeneviv/groups/abc
 */
export function publicIdFromUrl(url: string): string | null {
  if (!isCloudinaryUrlOnOurCloud(url)) return null;
  const match = new URL(url).pathname.match(/^\/[^/]+\/image\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  const publicId = match[1].replace(/\.[a-zA-Z0-9]+$/, "");
  return publicId || null;
}

/**
 * Best-effort delete of a logo we uploaded. Never throws: a failed cleanup must
 * not block a save. Failures are logged so they can be removed by hand later.
 */
export async function destroyLogo(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const publicId = publicIdFromUrl(url);
  if (!publicId) return;
  try {
    const { cloudName, apiKey, apiSecret } = ensureConfigured();
    const timestamp = Math.floor(Date.now() / 1000);
    // Cloudinary signature: sha1 of the sorted params followed by the API secret.
    const signature = createHash("sha1")
      .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
      .digest("hex");
    const form = new URLSearchParams({
      public_id: publicId,
      timestamp: String(timestamp),
      api_key: apiKey,
      signature,
    });
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
      method: "POST",
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as {
      result?: string;
      error?: { message?: string };
    };
    if (!res.ok || (body.result !== "ok" && body.result !== "not found")) {
      console.error(`[cloudinary] destroy ${publicId} failed:`, body.error?.message ?? res.status);
    }
  } catch (err) {
    console.error(`[cloudinary] destroy ${publicId} threw:`, err);
  }
}