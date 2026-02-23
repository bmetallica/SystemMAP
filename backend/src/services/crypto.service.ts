// ─── Crypto-Service ──────────────────────────────────────────────────────
// AES-256-GCM Verschlüsselung für SSH-Zugangsdaten
// Format: base64(iv):base64(authTag):base64(ciphertext)

import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;     // 128 Bit
const TAG_LENGTH = 16;    // 128 Bit

function getMasterKey(): Buffer {
  const hex = config.encryptionMasterKey;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_MASTER_KEY ungültig');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Verschlüsselt einen Klartext-String mit AES-256-GCM.
 * @returns Verschlüsselter String im Format iv:authTag:ciphertext (alle Base64)
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted,
  ].join(':');
}

/**
 * Entschlüsselt einen mit encrypt() verschlüsselten String.
 * @param encryptedText Format: iv:authTag:ciphertext (alle Base64)
 * @returns Klartext
 */
export function decrypt(encryptedText: string): string {
  const key = getMasterKey();
  const parts = encryptedText.split(':');

  if (parts.length !== 3) {
    throw new Error('Ungültiges Verschlüsselungsformat – erwartet iv:authTag:ciphertext');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Prüft ob die Verschlüsselung korrekt funktioniert (Self-Test beim Start).
 */
export function selfTest(): boolean {
  try {
    const testString = 'systemmap-crypto-self-test-' + Date.now();
    const encrypted = encrypt(testString);
    const decrypted = decrypt(encrypted);
    return decrypted === testString;
  } catch {
    return false;
  }
}
