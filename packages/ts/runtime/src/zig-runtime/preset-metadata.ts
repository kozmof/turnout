import type { BaseTypeSymbol } from "../state-control/value.js";
import { defaultZigRuntimeClient } from "./default-client.js";

type PresetMetadata = {
  inputType: BaseTypeSymbol | null;
  parameterType: BaseTypeSymbol | null;
  returnType: BaseTypeSymbol | null;
};

export function getPresetMetadata(name: string, elementType?: BaseTypeSymbol): PresetMetadata {
  const response = defaultZigRuntimeClient.value<PresetMetadata>({
    operation: "metadata",
    name,
    ...(elementType !== undefined && { elementType }),
  });
  if (response.status !== "ok") {
    return { inputType: null, parameterType: null, returnType: null };
  }
  return response.payload;
}
