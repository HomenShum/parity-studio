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
import type * as designRevisions from "../designRevisions.js";
import type * as generation from "../generation.js";
import type * as http from "../http.js";
import type * as inspiration from "../inspiration.js";
import type * as inspirationSearch from "../inspirationSearch.js";
import type * as lib_activeKitFiles from "../lib/activeKitFiles.js";
import type * as lib_autoRouter from "../lib/autoRouter.js";
import type * as lib_canonicalShape from "../lib/canonicalShape.js";
import type * as lib_designRevisions from "../lib/designRevisions.js";
import type * as lib_designSystemShowcase from "../lib/designSystemShowcase.js";
import type * as lib_figmaBridge from "../lib/figmaBridge.js";
import type * as lib_kitContract from "../lib/kitContract.js";
import type * as lib_nodeslideAccess from "../lib/nodeslideAccess.js";
import type * as lib_nodeslideData from "../lib/nodeslideData.js";
import type * as lib_nodeslideIds from "../lib/nodeslideIds.js";
import type * as lib_nodeslidePatches from "../lib/nodeslidePatches.js";
import type * as lib_nodeslidePreferenceEtl from "../lib/nodeslidePreferenceEtl.js";
import type * as lib_nodeslidePreferenceRetention from "../lib/nodeslidePreferenceRetention.js";
import type * as lib_nodeslideProvider from "../lib/nodeslideProvider.js";
import type * as lib_nodeslideQuota from "../lib/nodeslideQuota.js";
import type * as lib_nodeslideSeed from "../lib/nodeslideSeed.js";
import type * as lib_nodeslideSignatureProfiles from "../lib/nodeslideSignatureProfiles.js";
import type * as lib_nodeslideValidation from "../lib/nodeslideValidation.js";
import type * as lib_nodeslideValidators from "../lib/nodeslideValidators.js";
import type * as lib_nodeslideVariationHarness from "../lib/nodeslideVariationHarness.js";
import type * as lib_parityChecker from "../lib/parityChecker.js";
import type * as lib_piAi from "../lib/piAi.js";
import type * as lib_pipelineValidation from "../lib/pipelineValidation.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_qualityGate from "../lib/qualityGate.js";
import type * as lib_staticLint from "../lib/staticLint.js";
import type * as lib_uiKitParser from "../lib/uiKitParser.js";
import type * as nodeslide from "../nodeslide.js";
import type * as nodeslideAgent from "../nodeslideAgent.js";
import type * as nodeslidePreferences from "../nodeslidePreferences.js";
import type * as nodeslideSignatures from "../nodeslideSignatures.js";
import type * as nodeslideVariationProof from "../nodeslideVariationProof.js";
import type * as nodeslideVariationProvider from "../nodeslideVariationProvider.js";
import type * as nodeslideVariations from "../nodeslideVariations.js";
import type * as parityReports from "../parityReports.js";
import type * as projects from "../projects.js";
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
  designRevisions: typeof designRevisions;
  generation: typeof generation;
  http: typeof http;
  inspiration: typeof inspiration;
  inspirationSearch: typeof inspirationSearch;
  "lib/activeKitFiles": typeof lib_activeKitFiles;
  "lib/autoRouter": typeof lib_autoRouter;
  "lib/canonicalShape": typeof lib_canonicalShape;
  "lib/designRevisions": typeof lib_designRevisions;
  "lib/designSystemShowcase": typeof lib_designSystemShowcase;
  "lib/figmaBridge": typeof lib_figmaBridge;
  "lib/kitContract": typeof lib_kitContract;
  "lib/nodeslideAccess": typeof lib_nodeslideAccess;
  "lib/nodeslideData": typeof lib_nodeslideData;
  "lib/nodeslideIds": typeof lib_nodeslideIds;
  "lib/nodeslidePatches": typeof lib_nodeslidePatches;
  "lib/nodeslidePreferenceEtl": typeof lib_nodeslidePreferenceEtl;
  "lib/nodeslidePreferenceRetention": typeof lib_nodeslidePreferenceRetention;
  "lib/nodeslideProvider": typeof lib_nodeslideProvider;
  "lib/nodeslideQuota": typeof lib_nodeslideQuota;
  "lib/nodeslideSeed": typeof lib_nodeslideSeed;
  "lib/nodeslideSignatureProfiles": typeof lib_nodeslideSignatureProfiles;
  "lib/nodeslideValidation": typeof lib_nodeslideValidation;
  "lib/nodeslideValidators": typeof lib_nodeslideValidators;
  "lib/nodeslideVariationHarness": typeof lib_nodeslideVariationHarness;
  "lib/parityChecker": typeof lib_parityChecker;
  "lib/piAi": typeof lib_piAi;
  "lib/pipelineValidation": typeof lib_pipelineValidation;
  "lib/prompts": typeof lib_prompts;
  "lib/qualityGate": typeof lib_qualityGate;
  "lib/staticLint": typeof lib_staticLint;
  "lib/uiKitParser": typeof lib_uiKitParser;
  nodeslide: typeof nodeslide;
  nodeslideAgent: typeof nodeslideAgent;
  nodeslidePreferences: typeof nodeslidePreferences;
  nodeslideSignatures: typeof nodeslideSignatures;
  nodeslideVariationProof: typeof nodeslideVariationProof;
  nodeslideVariationProvider: typeof nodeslideVariationProvider;
  nodeslideVariations: typeof nodeslideVariations;
  parityReports: typeof parityReports;
  projects: typeof projects;
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
