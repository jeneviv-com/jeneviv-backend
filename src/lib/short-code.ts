import { customAlphabet } from "nanoid";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnpqrstvwxyz";

const id21 = customAlphabet(ALPHABET, 21);
const id8 = customAlphabet(ALPHABET, 8);

export function newId(): string {
  return id21();
}

export function newShortCode(): string {
  return id8();
}

export function newMerchantCode(): string {
  return id8();
}
