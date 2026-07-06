import { describe, it, expect } from "vitest";

interface ScoringConfig {
  dailyTarget: number;
  individualDailyTarget: number;
  weeklyDaysRequired: number;
  weeklyMultiplier: number;
  streakBase: number;
  streakCap: number;
  streakInterval: number;
  teamSize: number;
}

const DEFAULT_CONFIG: ScoringConfig = {
  dailyTarget: 5,
  individualDailyTarget: 1,
  weeklyDaysRequired: 5,
  weeklyMultiplier: 2,
  streakBase: 1,
  streakCap: 11,
  streakInterval: 10,
  teamSize: 3,
};

function dailyMultiplier(config: ScoringConfig, hasActiveTeam: boolean, allTeamHitTarget: boolean): number {
  if (!hasActiveTeam) return 1;
  return allTeamHitTarget ? config.teamSize : 1;
}

function individualStreakBonus(config: ScoringConfig, consecutiveDays: number): number {
  if (consecutiveDays < 2) return 0;
  return Math.min(
    config.streakCap,
    (Math.floor((consecutiveDays - 1) / config.streakInterval) + 1) * config.streakBase,
  );
}

function teamStreakBonus(config: ScoringConfig, consecutiveTeamDays: number, hasActiveTeam: boolean): number {
  if (!hasActiveTeam || consecutiveTeamDays < 2) return 0;
  const base = config.teamSize;
  const cap = config.teamSize * 11;
  return Math.min(
    cap,
    (Math.floor((consecutiveTeamDays - 1) / config.streakInterval) + 1) * base,
  );
}

function dailyScore(
  baseReps: number,
  dayMultiplier: number,
  indStreak: number,
  teamStreak: number,
): number {
  return baseReps * dayMultiplier + indStreak + teamStreak;
}

describe("Scoring formulas (specification tests)", () => {
  describe("daily multiplier", () => {
    it("is 1x for solo users", () => {
      expect(dailyMultiplier(DEFAULT_CONFIG, false, false)).toBe(1);
    });

    it("is 1x when team exists but not all hit target", () => {
      expect(dailyMultiplier(DEFAULT_CONFIG, true, false)).toBe(1);
    });

    it("equals team size when all members hit daily target", () => {
      expect(dailyMultiplier(DEFAULT_CONFIG, true, true)).toBe(3);
    });

    it("scales with team size", () => {
      const config = { ...DEFAULT_CONFIG, teamSize: 6 };
      expect(dailyMultiplier(config, true, true)).toBe(6);
    });
  });

  describe("individual streak bonus", () => {
    it("is 0 for no streak", () => {
      expect(individualStreakBonus(DEFAULT_CONFIG, 0)).toBe(0);
    });

    it("is 0 for day 1 (bonus starts at run >= 2)", () => {
      expect(individualStreakBonus(DEFAULT_CONFIG, 1)).toBe(0);
    });

    it("starts at streakBase (1) for day 2", () => {
      expect(individualStreakBonus(DEFAULT_CONFIG, 2)).toBe(1);
    });

    it("escalates by 1 every streakInterval (10) days", () => {
      expect(individualStreakBonus(DEFAULT_CONFIG, 11)).toBe(2);
      expect(individualStreakBonus(DEFAULT_CONFIG, 21)).toBe(3);
    });

    it("caps at streakCap (11)", () => {
      expect(individualStreakBonus(DEFAULT_CONFIG, 200)).toBe(11);
    });
  });

  describe("team streak bonus", () => {
    it("is 0 without an active team", () => {
      expect(teamStreakBonus(DEFAULT_CONFIG, 5, false)).toBe(0);
    });

    it("is 0 for day 1 (bonus starts at run >= 2)", () => {
      expect(teamStreakBonus(DEFAULT_CONFIG, 1, true)).toBe(0);
    });

    it("starts at teamSize (3) for day 2 with active team", () => {
      expect(teamStreakBonus(DEFAULT_CONFIG, 2, true)).toBe(3);
    });

    it("escalates every streakInterval days", () => {
      expect(teamStreakBonus(DEFAULT_CONFIG, 11, true)).toBe(6);
      expect(teamStreakBonus(DEFAULT_CONFIG, 21, true)).toBe(9);
    });

    it("caps at teamSize * 11 (33)", () => {
      expect(teamStreakBonus(DEFAULT_CONFIG, 200, true)).toBe(33);
    });
  });

  describe("daily score calculation", () => {
    it("solo user, no streak: score equals base reps", () => {
      const score = dailyScore(5, 1, 0, 0);
      expect(score).toBe(5);
    });

    it("team of 3, all hit MDR, day 2 streak (first bonus day)", () => {
      const mult = dailyMultiplier(DEFAULT_CONFIG, true, true);
      const indStreak = individualStreakBonus(DEFAULT_CONFIG, 2);
      const teamStreak = teamStreakBonus(DEFAULT_CONFIG, 2, true);
      const score = dailyScore(5, mult, indStreak, teamStreak);
      // 5 * 3 + 1 + 3 = 19
      expect(score).toBe(19);
    });

    it("team of 3, all hit MDR, day 100 streak", () => {
      const mult = dailyMultiplier(DEFAULT_CONFIG, true, true);
      const indStreak = individualStreakBonus(DEFAULT_CONFIG, 100);
      const teamStreak = teamStreakBonus(DEFAULT_CONFIG, 100, true);
      const score = dailyScore(5, mult, indStreak, teamStreak);
      // 5 * 3 + 10 + 30 = 55
      expect(score).toBe(55);
    });

    it("team of 3, all hit MDR, day 200 streak (both capped)", () => {
      const mult = dailyMultiplier(DEFAULT_CONFIG, true, true);
      const indStreak = individualStreakBonus(DEFAULT_CONFIG, 200);
      const teamStreak = teamStreakBonus(DEFAULT_CONFIG, 200, true);
      const score = dailyScore(5, mult, indStreak, teamStreak);
      // 5 * 3 + 11 + 33 = 59
      expect(score).toBe(59);
    });

    it("solo user, 50-day streak", () => {
      const indStreak = individualStreakBonus(DEFAULT_CONFIG, 50);
      const score = dailyScore(5, 1, indStreak, 0);
      // 5 * 1 + 5 + 0 = 10
      expect(score).toBe(10);
    });
  });
});
