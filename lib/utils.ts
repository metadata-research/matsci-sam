import { clsx, type ClassValue } from "clsx";
import { Diff, DiffOp } from "diff-match-patch-ts";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function diffToStringSimple(diff: Diff[]) {
  let value = "";
  for (const [operation, text] of diff) {
    if (operation === DiffOp.Insert || operation === DiffOp.Equal) value += text;
  }
  return value;
}
