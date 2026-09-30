-- VideoThon registration now asks for the state alongside the city.
-- Nullable: rows registered before this column existed have no state.
ALTER TABLE "HackathonVideoRegistration" ADD COLUMN "state" TEXT;
