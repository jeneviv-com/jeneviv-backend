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
  provider: "veripine" | "mock";
  raw: unknown;
}

interface VeripineData {
  firstname?: unknown;
  middlename?: unknown;
  surname?: unknown;
  lastname?: unknown;
  birthdate?: unknown;
  telephoneno?: unknown;
  photo?: unknown;
}

interface VeripineResponse {
  status?: unknown;
  message?: string;
  code?: number;
  data?: VeripineData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function lookupNin(nin: string): Promise<NinIdentity> {
  if (!env.VERIPINE_API_KEY) {
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
      "Identity verification is not configured. Set VERIPINE_API_KEY.",
    );
  }

  const url = new URL("/api/nin-verification", env.VERIPINE_BASE_URL);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.VERIPINE_API_KEY,
        Accept: "application/json",
      },
      method: "POST",
      body: JSON.stringify({ nin, consent: true }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(
      502,
      "kyc_provider_unreachable",
      "Could not reach the identity provider. Please try again.",
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    throw new HttpError(
      502,
      "kyc_failed",
      "Identity verification returned an invalid response. Please try again.",
    );
  }

  if (!isRecord(parsedBody)) {
    throw new HttpError(
      502,
      "kyc_failed",
      "Identity verification returned an invalid response. Please try again.",
    );
  }

  const body = parsedBody as VeripineResponse;
  if (!response.ok || body.status !== "success") {
    if (response.status === 404 || body.code === 404) {
      throw new HttpError(
        422,
        "nin_not_found",
        "No identity record was found for that NIN.",
      );
    }
    throw new HttpError(
      502,
      "kyc_failed",
      "Identity verification failed. Please try again.",
    );
  }

  if (!isRecord(body.data)) {
    throw new HttpError(
      502,
      "kyc_incomplete",
      "The identity provider returned incomplete identity data.",
    );
  }

  const entity = body.data;
  const firstName = optionalString(entity.firstname) ?? "";
  const middleName = optionalString(entity.middlename) ?? "";
  const lastName =
    optionalString(entity.surname) ?? optionalString(entity.lastname) ?? "";
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
    dateOfBirth: optionalString(entity.birthdate),
    phoneNumber: optionalString(entity.telephoneno),
    photo: optionalString(entity.photo),
    provider: "veripine",
    raw: body,
  };
}
