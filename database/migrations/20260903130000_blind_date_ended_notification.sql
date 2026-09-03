-- migrate:up

-- The other person is told their Blind-Date ended. Not why: whose slip it was is not theirs to be
-- handed, and naming it would put one member in front of the other over a mistake.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'blind_date_ended';

-- migrate:down

SELECT 1;
