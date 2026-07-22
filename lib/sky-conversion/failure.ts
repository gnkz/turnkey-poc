export type SkyConversionFailureCode =
  | "wrong-chain"
  | "unavailable-read"
  | "invalid-chain-data"
  | "invalid-address";

export class SkyConversionFailure extends Error {
  readonly code: SkyConversionFailureCode;

  constructor(code: SkyConversionFailureCode, message: string) {
    super(message);
    this.name = "SkyConversionFailure";
    this.code = code;
  }
}
