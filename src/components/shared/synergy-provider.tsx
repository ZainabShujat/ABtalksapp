"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { getMySynergyAction } from "@/app/actions/synergy-actions";

type Ctx = {
  points: number | null;
  setPoints: (n: number) => void;
  refresh: () => void;
};

const SynergyContext = createContext<Ctx | null>(null);

export function SynergyProvider({ children }: { children: React.ReactNode }) {
  const [points, setPointsState] = useState<number | null>(null);

  const setPoints = useCallback((n: number) => {
    setPointsState(n);
  }, []);

  const refresh = useCallback(() => {
    void getMySynergyAction().then((res) => setPoints(res.points));
  }, [setPoints]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SynergyContext.Provider value={{ points, setPoints, refresh }}>
      {children}
    </SynergyContext.Provider>
  );
}

export function useSynergy(): Ctx {
  const ctx = useContext(SynergyContext);
  if (!ctx) return { points: null, setPoints: () => {}, refresh: () => {} };
  return ctx;
}
