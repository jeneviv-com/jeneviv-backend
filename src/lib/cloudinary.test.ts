import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("../env.js", () => ({
  env: {
    CLOUDINARY_CLOUD_NAME: "jeneviv-media",
    CLOUDINARY_API_KEY: "test-api-key",
    CLOUDINARY_API_SECRET: "test-api-secret",
  },
}));

import { isCloudinaryUrlOnOurCloud, signUpload } from "./cloudinary.js";

describe("Cloudinary helpers", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("signs an image upload with the signed folder and timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));

    const upload = signUpload({ folder: "jeneviv/groups" });
    const expected = createHash("sha1")
      .update(`folder=jeneviv/groups&timestamp=1793188800test-api-secret`)
      .digest("hex");

    expect(upload.resource_type).toBe("image");
    expect(upload.upload_url).toBe(
      "https://api.cloudinary.com/v1_1/jeneviv-media/image/upload",
    );
    expect(upload.signature).toBe(expected);
  });

  it.each([
    "https://res.cloudinary.com/jeneviv-media/image/upload/v123/logo.png",
    "https://res.cloudinary.com/JENEVIV-MEDIA/raw/upload/logo.pdf",
  ])("accepts valid same-cloud delivery URL %s", (url) => {
    expect(isCloudinaryUrlOnOurCloud(url)).toBe(true);
  });

  it.each([
    "http://res.cloudinary.com/jeneviv-media/image/upload/logo.png",
    "https://res.cloudinary.com.evil.test/jeneviv-media/image/upload/logo.png",
    "https://other.cloudinary.com/jeneviv-media/image/upload/logo.png",
    "https://res.cloudinary.com/another-cloud/image/upload/logo.png",
    "https://res.cloudinary.com/jeneviv-media/upload/logo.png",
    "https://user@res.cloudinary.com/jeneviv-media/image/upload/logo.png",
    "https://res.cloudinary.com:444/jeneviv-media/image/upload/logo.png",
  ])("rejects untrusted delivery URL %s", (url) => {
    expect(isCloudinaryUrlOnOurCloud(url)).toBe(false);
  });
});
