-- migrate:up

-- A level above the roles rather than another value in them, which is why this is its own column
-- and not a third `platform_role`. The role says what somebody may do; this says that one account
-- is the origin of the others — it grants and revokes the administrator role, and nothing can
-- take that from it.
--
-- Created at startup by the application, never by a migration: the password is hashed with scrypt
-- by `util/password.ts`, and a hash written into SQL here would be a committed credential in a
-- public repository.
ALTER TABLE public.user
    ADD COLUMN is_primordial_admin BOOLEAN NOT NULL DEFAULT false;

-- The real guarantee that no route can demote it, rather than a check written in TypeScript that
-- some later handler forgets: the database itself refuses the row. `grant_role.ts` on the command
-- line is bound by this too, which is the point — "nobody" has to mean nobody.
--
-- `IS NOT DISTINCT FROM`, not `=`: a CHECK passes when its expression is NULL, and `platform_role
-- = 'administrator'` is NULL for a null role — so plain equality would have allowed revoking the
-- role outright, which is precisely the move this exists to refuse. Verified by trying it.
ALTER TABLE public.user
    ADD CONSTRAINT user_primordial_admin_is_an_administrator CHECK (
        NOT is_primordial_admin OR platform_role IS NOT DISTINCT FROM 'administrator'
        );

-- At most one, ever. A unique index over a constant, restricted to the rows that claim it, is
-- how Postgres expresses "only one row may be true" — a second bootstrap cannot race in.
CREATE UNIQUE INDEX user_one_primordial_admin_idx
    ON public.user ((true)) WHERE is_primordial_admin;

-- migrate:down

DROP INDEX public.user_one_primordial_admin_idx;

ALTER TABLE public.user
    DROP CONSTRAINT user_primordial_admin_is_an_administrator;

ALTER TABLE public.user
    DROP COLUMN is_primordial_admin;
