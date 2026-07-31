import "server-only";
import { createFlareContext, createPublicFlareContext, type FlareContext, type PublicFlareContext } from "../flare/context";

export function getServerContext(): FlareContext {
  return createFlareContext("coston2");
}

export function getServerPublicContext(): PublicFlareContext {
  return createPublicFlareContext("coston2");
}
