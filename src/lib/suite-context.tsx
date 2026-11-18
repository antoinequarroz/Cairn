"use client";

import { createContext, useContext } from "react";
import type { SuiteApp } from "./suite";

export type Suite = { apps: SuiteApp[]; account: string | null };

const SuiteContext = createContext<Suite>({ apps: [], account: null });

export const SuiteProvider = SuiteContext.Provider;

/** The other apps of the suite, and the address of the Compte Postmelo when Cairn is connected to it. */
export const useSuite = () => useContext(SuiteContext);
