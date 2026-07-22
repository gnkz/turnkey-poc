import { ethereumClient } from "@/lib/ethereum";

import { createSkyConversion } from "./sky-conversion";
import { createViemEthereumReader } from "./viem-ethereum-reader";

const ethereumReader = createViemEthereumReader((request, options) =>
  ethereumClient.request(request, options),
);

export const skyConversion = createSkyConversion(ethereumReader);

export { SkyConversionFailure } from "./failure";
export type { SkyConversionFailureCode } from "./failure";
export type {
  ConversionPlan,
  ConversionPlanCall,
  ConversionPlanCallMeaning,
  ConversionPlanIneligibilityReason,
  ConversionPlanPreparation,
  SkyConversion,
  SkyConversionAsset,
  SkyConversionDirection,
  SkyConversionDirectionOverview,
  SkyConversionOverview,
} from "./sky-conversion";
