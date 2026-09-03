-- migrate:up

-- Which email domains may not register. A table rather than a list in the code, because new
-- throwaway-mail providers appear constantly and a deploy per provider is the wrong cost for
-- something the operators already know and can write down themselves.
--
-- Administrator rather than moderator territory, which is why the route guards on the stricter
-- of the two: this decides who may join at all, not what happens to one account.
CREATE TABLE public.blocked_email_domain
(
    domain   TEXT PRIMARY KEY,
    -- Nullable for the same reason everywhere else: the account that added it may be deleted
    -- later, and losing who did it must not lift the block.
    added_by UUID        REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Optional, unlike a ban's reason: "a known throwaway provider" is usually explanation
    -- enough, and the note is for the cases that are not — "keeps turning up on duplicate
    -- accounts", say.
    note     TEXT
);

-- Seeded so the list works the moment the migration runs, rather than starting empty and
-- catching nobody until somebody remembers to fill it in.
INSERT INTO public.blocked_email_domain (domain, note)
VALUES ('10minutemail.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('10minutemail.net', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('10minutemail.de', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('20minutemail.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('guerrillamail.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('guerrillamail.net', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('guerrillamail.org', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('guerrillamail.biz', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('sharklasers.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('mailinator.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('mailinator.net', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('mailinator.org', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('tempmail.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('temp-mail.org', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('tempmail.net', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('throwawaymail.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('trashmail.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('trashmail.de', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('trash-mail.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('yopmail.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('yopmail.net', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('yopmail.fr', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('fakeinbox.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('mintemail.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('getnada.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('moakt.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('dispostable.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('mohmal.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('emailondeck.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('maildrop.cc', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('mail-temporaire.fr', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('wegwerfmail.de', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('wegwerfemail.de', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('einrot.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('spambog.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('spamgourmet.com', 'Bekannter Wegwerf-Mail-Anbieter'),
       ('byom.de', 'Bekannter Wegwerf-Mail-Anbieter');

-- migrate:down

DROP TABLE public.blocked_email_domain;
