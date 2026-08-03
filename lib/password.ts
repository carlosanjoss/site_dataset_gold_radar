import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function validatePassword(password: string) {
  if (password.length < 10 || password.length > 128) {
    return "A senha deve ter entre 10 e 128 caracteres.";
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    return "Use pelo menos uma letra maiúscula e uma minúscula.";
  }
  if (!/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return "Use pelo menos um número e um caractere especial.";
  }
  return null;
}

export async function hashPassword(password: string, salt?: string) {
  const passwordSalt = salt || randomBytes(16).toString("hex");
  const derived = (await scrypt(password, passwordSalt, 64)) as Buffer;
  return {
    hash: derived.toString("hex"),
    salt: passwordSalt,
  };
}

export async function verifyPassword(
  password: string,
  salt: string,
  storedHash: string,
) {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(storedHash, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let body = "";
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `${body.slice(0, 4)}@${body.slice(4, 8)}#${body.slice(8)}7aA`;
}
