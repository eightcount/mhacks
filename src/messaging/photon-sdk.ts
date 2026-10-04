import { imessage as provider } from "@spectrum-ts/imessage";
import type { PlatformProviderConfig, Space, SpectrumInstance } from "@spectrum-ts/core";
import { z } from "zod";

// The pinned 12.10.1 provider's declaration loses its definition in a conditional
// type. Keep this compatibility assertion at the SDK boundary; validate incoming
// provider-specific space fields before routing. No application type is weakened.
interface IMessageProvider {
  config(): PlatformProviderConfig;
  (app: SpectrumInstance): {space: {create(recipient: string, params?: {phone: string}): Promise<Space>}};
}
export const imessage = provider as unknown as IMessageProvider;
export const iMessageSpaceSchema = z.object({type: z.enum(["dm", "group"]), phone: z.string().min(1)});
