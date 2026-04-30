/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as artifacts from "../artifacts.js";
import type * as chat from "../chat.js";
import type * as chatLoop from "../chatLoop.js";
import type * as comments from "../comments.js";
import type * as generation from "../generation.js";
import type * as http from "../http.js";
import type * as lib_activeKitFiles from "../lib/activeKitFiles.js";
import type * as lib_autoRouter from "../lib/autoRouter.js";
import type * as lib_canonicalShape from "../lib/canonicalShape.js";
import type * as lib_kitContract from "../lib/kitContract.js";
import type * as lib_parityChecker from "../lib/parityChecker.js";
import type * as lib_piAi from "../lib/piAi.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_staticLint from "../lib/staticLint.js";
import type * as lib_uiKitParser from "../lib/uiKitParser.js";
import type * as parityReports from "../parityReports.js";
import type * as runs from "../runs.js";
import type * as uiKits from "../uiKits.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  artifacts: typeof artifacts;
  chat: typeof chat;
  chatLoop: typeof chatLoop;
  comments: typeof comments;
  generation: typeof generation;
  http: typeof http;
  "lib/activeKitFiles": typeof lib_activeKitFiles;
  "lib/autoRouter": typeof lib_autoRouter;
  "lib/canonicalShape": typeof lib_canonicalShape;
  "lib/kitContract": typeof lib_kitContract;
  "lib/parityChecker": typeof lib_parityChecker;
  "lib/piAi": typeof lib_piAi;
  "lib/prompts": typeof lib_prompts;
  "lib/staticLint": typeof lib_staticLint;
  "lib/uiKitParser": typeof lib_uiKitParser;
  parityReports: typeof parityReports;
  runs: typeof runs;
  uiKits: typeof uiKits;
  workflows: typeof workflows;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  persistentTextStreaming: import("@convex-dev/persistent-text-streaming/_generated/component.js").ComponentApi<"persistentTextStreaming">;
};
