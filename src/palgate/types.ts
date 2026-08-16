/** PalGate session / derived-token types (secondary device linking uses SECONDARY). */
export enum TokenType {
  SMS = 0,
  PRIMARY = 1,
  SECONDARY = 2,
}

export type PalGateCredentials = {
  phoneNumber: number;
  /** Session token as hex string (16 bytes). */
  sessionToken: string;
  tokenType: TokenType;
};

export type PalGateApiEnvelope = {
  status?: string;
  err?: boolean | string | number | null;
  msg?: string;
  [key: string]: unknown;
};

export type SecondaryInitResponse = PalGateApiEnvelope & {
  user?: {
    id?: string | number;
    token?: string;
  };
  secondary?: string | number | boolean;
};

export type SplitDeviceId = {
  baseId: string;
  outputNum: number;
};

export type LinkingResult = {
  phoneNumber: number;
  sessionToken: string;
  tokenType: TokenType;
};
