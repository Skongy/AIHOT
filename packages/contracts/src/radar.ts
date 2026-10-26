export type RadarKind = "breakout" | "comeback" | "watch";
export interface RadarPoint { at: string; count: number }
export interface RadarEvidence { label: string; url: string; note: string; articleId?: string }
export interface RadarEvent {
  id: string; appid: number; name: string; zh: string; date: string; genre: string;
  kind: RadarKind; status: "confirmed" | "suspected";
  baseline: number | null; baselineDays: number; peak: number; rankBefore: number | null; rankAfter: number | null;
  coverage: "complete" | "partial"; points: RadarPoint[]; headline: string;
  reason: string | null; evidence: RadarEvidence[]; coverUrl: string | null;
  source: "historical" | "live"; detectedAt: string; timezone: "Asia/Shanghai";
}
export interface RadarMonth {
  month: string; events: RadarEvent[];
  coverage: Array<{ date: string; games: number; samples: number }>;
  status: { lastSuccess: string | null; lastAttempt: string | null; healthy: boolean; tracked: number };
}
