package com.gateauto.app.keepalive;

final class PalGateToken {
  private PalGateToken() {}

  /** X-Bt-Token hex uppercase. tokenType: 0 SMS, 1 PRIMARY, 2 SECONDARY. */
  static String generate(String sessionHex, long phoneNumber, int tokenType, long unixSeconds) {
    byte[] session = PalGateAes.hexToBytes(sessionHex);
    if (session.length != PalGateAes.BLOCK) {
      throw new IllegalArgumentException("Invalid session token");
    }
    byte[] step2Key = step1(session, phoneNumber);
    byte[] step2Result = step2(step2Key, unixSeconds, PalGateAes.TIMESTAMP_OFFSET);
    byte[] result = new byte[PalGateAes.TOKEN_SIZE];
    if (tokenType == 0) {
      result[0] = 0x01;
    } else if (tokenType == 1) {
      result[0] = 0x11;
    } else if (tokenType == 2) {
      result[0] = 0x21;
    } else {
      throw new IllegalArgumentException("unknown token type: " + tokenType);
    }
    byte[] phonePacked = PalGateAes.packUint64BE(phoneNumber);
    System.arraycopy(phonePacked, 2, result, 1, 6);
    System.arraycopy(step2Result, 0, result, 7, 16);
    return PalGateAes.bytesToHex(result).toUpperCase();
  }

  private static byte[] step1(byte[] sessionToken, long phoneNumber) {
    byte[] key = PalGateAes.T_C_KEY.clone();
    byte[] phonePacked = PalGateAes.packUint64BE(phoneNumber);
    for (int i = 0; i < 6; i++) {
      key[6 + i] = phonePacked[2 + i];
    }
    return PalGateAes.aesBlock(sessionToken, key, true);
  }

  private static byte[] step2(byte[] resultFromStep1, long unixSeconds, int timestampOffset) {
    byte[] nextState = new byte[PalGateAes.BLOCK];
    int val16 = 0x0a0a;
    nextState[1] = (byte) (val16 & 0xff);
    nextState[2] = (byte) ((val16 >> 8) & 0xff);
    int val32 = (int) (unixSeconds + timestampOffset);
    nextState[10] = (byte) ((val32 >> 24) & 0xff);
    nextState[11] = (byte) ((val32 >> 16) & 0xff);
    nextState[12] = (byte) ((val32 >> 8) & 0xff);
    nextState[13] = (byte) (val32 & 0xff);
    return PalGateAes.aesBlock(nextState, resultFromStep1, false);
  }
}
