/**
 * The source-control providers this service accepts webhooks from.
 *
 * Every other model, adapter, and factory keys off this type rather than
 * a raw string, so adding a third provider later is a one-place change
 * the compiler will help propagate everywhere it needs handling.
 */
export type Provider = "github" | "gitlab";
