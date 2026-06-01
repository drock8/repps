type MascotPose = "dab" | "pumped" | "lfg";

const MASCOTS: Record<string, Record<MascotPose, string>> = {
  orange: {
    dab: "/DAB-Repps-Mascot.png",
    pumped: "/Leaderboard-Mascot-Repps.png",
    lfg: "/LFG-Repps-Mascot.png",
  },
  blue: {
    dab: "/DAB-Repps-Mascot.png",
    pumped: "/Leaderboard-Mascot-Repps.png",
    lfg: "/LFG-Repps-Mascot.png",
  },
  yellow: {
    dab: "/Repps-Dab-Yellow.png",
    pumped: "/Repps-Pumped-Yellow.png",
    lfg: "/LFG-Repps-Mascot.png",
  },
};

const FALLBACK = MASCOTS.orange;

export function getMascot(theme: string, pose: MascotPose): string {
  return (MASCOTS[theme] ?? FALLBACK)[pose];
}
