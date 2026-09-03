-- migrate:up

-- Whether a question is answered in the member's own words or picked from a list the operators
-- wrote. Two kinds only: anything more is a form builder, which this is not.
CREATE TYPE public.profile_question_kind AS ENUM ('text', 'choice');

-- The optional profile questions, defined by the operators instead of by a column each. The
-- seven fixed profile columns on `user` stay where they are: those are the ones the product
-- itself asks, and they are read by name in the interface.
CREATE TABLE public.profile_question
(
    id       UUID PRIMARY KEY                     DEFAULT uuidv7(),
    -- Which part of the profile it appears under — „Persönliches", „Rollenspiele & ich". Free
    -- text rather than an enum, because inventing a section is exactly the kind of change this
    -- table exists to allow without a migration.
    section  TEXT                        NOT NULL,
    prompt   TEXT                        NOT NULL,
    kind     public.profile_question_kind NOT NULL,
    -- Where it sits among the others. Not unique: two questions given the same position are a
    -- display detail, not a state worth refusing an edit over.
    position INTEGER                     NOT NULL DEFAULT 0
);

CREATE INDEX profile_question_section_idx ON public.profile_question (section, position);

-- What a 'choice' question offers. A 'text' question has none; nothing enforces that beyond the
-- interface, because a question changed from choice to text and back should keep its options.
CREATE TABLE public.profile_question_option
(
    id          UUID PRIMARY KEY      DEFAULT uuidv7(),
    question_id UUID         NOT NULL REFERENCES public.profile_question (id) ON UPDATE CASCADE ON DELETE CASCADE,
    label       TEXT         NOT NULL,
    position    INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX profile_question_option_question_id_idx
    ON public.profile_question_option (question_id, position);

-- One answer per member per question. An unanswered question has no row, which is what makes
-- "leave it out of the profile entirely" the natural reading rather than a special case.
CREATE TABLE public.profile_answer
(
    user_id     UUID    NOT NULL REFERENCES public.user (id) ON UPDATE CASCADE ON DELETE CASCADE,
    question_id UUID    NOT NULL REFERENCES public.profile_question (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- Set for a 'text' question.
    answer_text TEXT,
    -- Set for a 'choice' question. The option going away takes the answer with it, because an
    -- answer pointing at a choice that no longer exists says nothing.
    option_id   UUID    REFERENCES public.profile_question_option (id) ON UPDATE CASCADE ON DELETE CASCADE,
    PRIMARY KEY (user_id, question_id),
    -- Exactly one of the two, never both and never neither: an answer that is neither is an
    -- unanswered question, and those have no row at all.
    CONSTRAINT profile_answer_is_one_kind CHECK (
        (answer_text IS NOT NULL AND option_id IS NULL)
            OR (answer_text IS NULL AND option_id IS NOT NULL)
        )
);

-- migrate:down

DROP TABLE public.profile_answer;

DROP INDEX public.profile_question_option_question_id_idx;

DROP TABLE public.profile_question_option;

DROP INDEX public.profile_question_section_idx;

DROP TABLE public.profile_question;

DROP TYPE public.profile_question_kind;
