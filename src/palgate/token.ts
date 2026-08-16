import {
  BLOCK_SIZE,
  TIMESTAMP_OFFSET,
  TOKEN_SIZE,
  T_C_KEY,
  aesBlock,
  bytesToHex,
  hexToBytes,
  packUint64BE,
} from './aes';
import { TokenType } from './types';

/**
 * Generate time-sensitive X-Bt-Token (23-byte hex uppercase).
 * Ported from homebridge-palgate / pylgate.
 */
export function generateToken(
  sessionToken: Uint8Array | string,
  phoneNumber: number,
  tokenType: TokenType,
  timestampMs: number | null = null,
  timestampOffset: number = TIMESTAMP_OFFSET,
): string {
  const session =
    typeof sessionToken === 'string' ? hexToBytes(sessionToken) : sessionToken;

  if (session.length !== BLOCK_SIZE) {
    throw new Error('Invalid session token');
  }

  const ts = timestampMs ?? Math.floor(Date.now() / 1000);
  const step2Key = step1(session, phoneNumber);
  const step2Result = step2(step2Key, ts, timestampOffset);

  const result = new Uint8Array(TOKEN_SIZE);
  if (tokenType === TokenType.SMS) {
    result[0] = 0x01;
  } else if (tokenType === TokenType.PRIMARY) {
    result[0] = 0x11;
  } else if (tokenType === TokenType.SECONDARY) {
    result[0] = 0x21;
  } else {
    throw new Error(`unknown token type: ${tokenType}`);
  }

  const phonePacked = packUint64BE(phoneNumber);
  result.set(phonePacked.slice(2, 8), 1);
  result.set(step2Result, 7);

  return bytesToHex(result).toUpperCase();
}

function step1(sessionToken: Uint8Array, phoneNumber: number): Uint8Array {
  const key = new Uint8Array(T_C_KEY);
  const phonePacked = packUint64BE(phoneNumber);
  for (let i = 0; i < 6; i++) {
    key[6 + i] = phonePacked[2 + i];
  }
  // homebridge aesBlock(..., true) — matches pylgate is_encrypt=True despite name
  return aesBlock(sessionToken, key, true);
}

function step2(
  resultFromStep1: Uint8Array,
  timestampMs: number,
  timestampOffset: number,
): Uint8Array {
  const nextState = new Uint8Array(BLOCK_SIZE);
  const val16 = 0xa0a;
  nextState[1] = val16 & 0xff;
  nextState[2] = (val16 >> 8) & 0xff;
  const val32 = timestampMs + timestampOffset;
  nextState[10] = (val32 >> 24) & 0xff;
  nextState[11] = (val32 >> 16) & 0xff;
  nextState[12] = (val32 >> 8) & 0xff;
  nextState[13] = val32 & 0xff;
  return aesBlock(nextState, resultFromStep1, false);
}
