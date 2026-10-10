export interface Price {
  /** USD per million input tokens. */
  inputPer1M: number;
  /** USD per million output tokens. */
  outputPer1M: number;
}

/** Estimated USD cost of one call, from the price table in config. Unknown providers cost 0. */
export function estimateCost(
  prices: Record<string, Price>,
  provider: string | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = provider ? prices[provider] : undefined;
  if (!price) return 0;
  const usd = (inputTokens * price.inputPer1M + outputTokens * price.outputPer1M) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
