import { type RecordValue, type TagSymbol } from "../../value.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface TransformFnRecord {
  pass: (value: RecordValue<readonly TagSymbol[]>) => RecordValue<readonly TagSymbol[]>;
}

export const tfRecord: TransformFnRecord = {
  pass: (value) => value,
} as const;

export type TransformFnRecordNameSpace = "transformFnRecord";
export type TransformFnRecordNames =
  `${TransformFnRecordNameSpace}${NamespaceDelimiter}${keyof typeof tfRecord}`;

export type ReturnMetaTransformFnRecord = {
  [K in keyof TransformFnRecord]: ReturnType<TransformFnRecord[K]>["symbol"];
};
