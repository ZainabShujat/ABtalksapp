-- Plan 154. Four additive RateLimitBucket values for password and email-code
-- sign-in. No table is rewritten and no row changes.
--
-- LOGIN_PASSWORD_ACCOUNT / LOGIN_PASSWORD_IP bound password guessing per
-- account and per client. EMAIL_CODE_ADDRESS / EMAIL_CODE_IP bound how many
-- codes one mailbox receives and one client can request — the per-address
-- count that used to live on RecruiterEmailOtp never exceeded 1, because every
-- new code deletes the previous row.
--
-- ALTER TYPE ... ADD VALUE is safe on Neon (PostgreSQL 16) and Prisma issues
-- these outside a transaction anyway.

ALTER TYPE "RateLimitBucket" ADD VALUE IF NOT EXISTS 'LOGIN_PASSWORD_ACCOUNT';
ALTER TYPE "RateLimitBucket" ADD VALUE IF NOT EXISTS 'LOGIN_PASSWORD_IP';
ALTER TYPE "RateLimitBucket" ADD VALUE IF NOT EXISTS 'EMAIL_CODE_ADDRESS';
ALTER TYPE "RateLimitBucket" ADD VALUE IF NOT EXISTS 'EMAIL_CODE_IP';
