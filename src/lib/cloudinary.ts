import { createHash } from "node:crypto";
import { env } from "../env.js";

export interface SignUploadArgs {
  /** Optional Cloudinary folder. Restricted to a safe charset to avoid path tricks. */
  folder?: string;
  /** Cloudinary resource type. */
  resourceType?: "image" | "raw" | "video" | "auto";
}

export interface SignedUploadParams {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  signature: string;
  resource_type: "image" | "raw" | "video" | "auto";
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
  const resourceType = args.resourceType ?? "auto";

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
 * Accepts both `res.cloudinary.com/<cloud>/...` and `<cloud>-res.cloudinary.com/...`
 * shapes.
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
  const host = parsed.hostname.toLowerCase();
  if (host === "res.cloudinary.com") {
    return parsed.pathname.startsWith(`/${cloud.toLowerCase()}/`);
  }
  return false;
}
