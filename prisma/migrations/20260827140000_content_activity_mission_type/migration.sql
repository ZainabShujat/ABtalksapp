-- Additive. Reuses existing ProgramMissionType (CODE_SPRINT, SHIP_IT,
-- DATA_ROOM, PROMPT_FORGE, BOSS_BUILD). Null on DailyTask/video content configs.

ALTER TABLE "ContentActivityConfig"
  ADD COLUMN "missionType" "ProgramMissionType";
