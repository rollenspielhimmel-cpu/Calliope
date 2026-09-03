-- migrate:up

-- Who may work the Blind-Date desk.
--
-- **A right of its own, not a role.** Being a moderator says somebody may act on reports and
-- accounts; it says nothing about whether they should see who is hoping to be paired with whom, or
-- decide it. Those are the most personal decisions on the platform, and the team asked for them to
-- be given out by name rather than to follow from a rank.
--
-- Granted and taken away **only by the root administrator** — the account the first start creates.
-- That is enforced in the route, and it is why the right lives here rather than in
-- `platform_role`: an administrator may grant a platform role, and this must not come with one.
--
-- **The suspension is not here**, deliberately. A manager who applies for a Blind-Date themselves
-- loses this access until their own application is settled, and that is derived from the
-- application's own status rather than written down beside it. A stored flag would have to be set
-- when they apply, cleared when they are matched, cleared again when they withdraw, and cleared by
-- hand when any of those paths grew a fourth case — and every one of those is a chance for somebody
-- to keep an access they should not have. See `blind_date_access_service.ts`.
ALTER TABLE public."user"
    ADD COLUMN may_manage_blind_date BOOLEAN NOT NULL DEFAULT FALSE;

-- migrate:down

ALTER TABLE public."user"
    DROP COLUMN may_manage_blind_date;
