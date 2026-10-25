import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";

export interface NinIdentity {
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  dateOfBirth: string | null;
  phoneNumber: string | null;
  photo: string | null;
  provider: "dojah" | "mock";
  raw: unknown;
}

interface DojahEntity {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  date_of_birth?: string;
  phone_number?: string;
  photo?: string;
}

interface DojahResponse {
  entity?: DojahEntity;
  error?: string;
  message?: string;
}

/**
 * Dojah sends the secret key raw in Authorization (no Bearer prefix) and the
 * app id in AppId. Non-2xx is mapped to a user-safe error so callers never
 * leak provider bodies.
 */
export async function lookupNin(nin: string): Promise<NinIdentity> {
  if (!env.DOJAH_APP_ID || !env.DOJAH_SECRET_KEY) {
    if (env.ALLOW_PROVIDER_MOCKS) {
      const fullName = env.KYC_MOCK_LEGAL_NAME.trim();
      const parts = fullName.split(/\s+/);
      return {
        firstName: parts[0] ?? "",
        middleName: parts.slice(1, -1).join(" "),
        lastName: parts.length > 1 ? (parts[parts.length - 1] ?? "") : "",
        fullName,
        dateOfBirth: null,
        phoneNumber: null,
        photo: null,
        provider: "mock",
        raw: { nin, mock: true },
      };
    }
    throw new HttpError(
      503,
      "kyc_not_configured",
      "Identity verification is not configured. Set DOJAH_APP_ID and DOJAH_SECRET_KEY.",
    );
  }

  const url = new URL("/api/v1/kyc/nin", env.DOJAH_BASE_URL);
  url.searchParams.set("nin", nin);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: env.DOJAH_SECRET_KEY,
        AppId: env.DOJAH_APP_ID,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(
      502,
      "kyc_provider_unreachable",
      "Could not reach the identity provider. Please try again.",
    );
  }

  const body = (await response.json().catch(() => ({}))) as DojahResponse;
  if (!response.ok || !body.entity) {
    const providerMessage = body.error ?? body.message ?? "";
    if (response.status === 404) {
      throw new HttpError(
        422,
        "nin_not_found",
        "No identity record was found for that NIN.",
      );
    }
    throw new HttpError(
      502,
      "kyc_failed",
      providerMessage
        ? `Identity verification failed: ${providerMessage}`
        : "Identity verification failed. Please try again.",
    );
  }

  const entity = body.entity;
  const firstName = (entity.first_name ?? "").trim();
  const middleName = (entity.middle_name ?? "").trim();
  const lastName = (entity.last_name ?? "").trim();
  const fullName = [firstName, middleName, lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!fullName) {
    throw new HttpError(
      502,
      "kyc_incomplete",
      "The identity provider returned no name for that NIN.",
    );
  }

  return {
    firstName,
    middleName,
    lastName,
    fullName,
    dateOfBirth: entity.date_of_birth ?? null,
    phoneNumber: entity.phone_number ?? null,
    photo: entity.photo ?? null,
    provider: "dojah",
    raw: body,
  };
}
