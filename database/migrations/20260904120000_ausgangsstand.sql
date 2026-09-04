-- migrate:up

-- **The starting point.**
--
-- One file in place of the fifty-four that produced this schema between 16 August and 4 September
-- 2026. They are not lost: the last commit that carried all of them is
--
--     5440fae  Die Vorladungen hängen an der Sperre, nicht an einem Kommentar
--
-- and `git show 5440fae:database/migrations/` lists every one of them. Where a constraint here
-- looks arbitrary, that is where the reasoning is — each of those files carried its own, and a
-- machine-written dump cannot carry any of it.
--
-- **Why now.** Fifteen files for the Blind-Date alone, fifty-four in total, none of them ever run
-- against real data. Squashing is only honest while that is true: after the first member writes
-- something, a migration is a record of what happened to their rows and may not be rewritten. This
-- window closes at the beta's opening and does not reopen.
--
-- **How it was made**, so it can be checked rather than believed: a fresh database, all fifty-four
-- applied in order, then `pg_dump` with schema *and* data. With data because five of those
-- migrations insert some — the blocked mail providers, the Blind-Date page, its rules — and a
-- schema-only dump would have dropped the rules on the floor without a word.
--
-- The dump's own psql directives are stripped and its `COPY` blocks are `INSERT`s, because
-- dbmate runs this over an ordinary connection where neither would work.
--
-- **Verified against what it replaces**: a database built from the fifty-four and one built from
-- this file were dumped and compared line by line, the generated Kysely types were compared, and
-- both suites were run. See the commit message for the numbers.

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: avatar_origin; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.avatar_origin AS ENUM (
    'own_work',
    'licence',
    'permission',
    'public_domain',
    'other'
);


--
-- Name: blind_date_again; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.blind_date_again AS ENUM (
    'yes',
    'maybe',
    'no'
);


--
-- Name: blind_date_application_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.blind_date_application_status AS ENUM (
    'pending',
    'matched',
    'declined',
    'withdrawn',
    'expired'
);


--
-- Name: blind_date_pairing; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.blind_date_pairing AS ENUM (
    'fm',
    'ff',
    'mm',
    'dd',
    'any'
);


--
-- Name: blind_date_post_length; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.blind_date_post_length AS ENUM (
    'short',
    'medium',
    'long'
);


--
-- Name: blind_date_verdict; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.blind_date_verdict AS ENUM (
    'yes',
    'partly',
    'no'
);


--
-- Name: blind_date_writing_style; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.blind_date_writing_style AS ENUM (
    'prose',
    'asterisk'
);


--
-- Name: forum_visibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.forum_visibility AS ENUM (
    'everyone',
    'members',
    'moderation',
    'administration'
);


--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_type AS ENUM (
    'invited_to_writing_group',
    'invitation_accepted',
    'role_changed_in_writing_group',
    'visibility_changed_in_writing_group',
    'new_writing_thread',
    'new_writing_post',
    'new_writing_page',
    'invited_to_chat_group',
    'blind_date_matched',
    'blind_date_reveal_requested',
    'blind_date_ended'
);


--
-- Name: platform_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.platform_role AS ENUM (
    'moderator',
    'administrator'
);


--
-- Name: profile_question_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.profile_question_kind AS ENUM (
    'text',
    'choice'
);


--
-- Name: report_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_category AS ENUM (
    'harassment',
    'hate',
    'violence',
    'sexual_content',
    'self_harm',
    'illegal_content',
    'missing_content_warning',
    'plagiarism',
    'spam',
    'legal_issue',
    'other'
);


--
-- Name: report_outcome; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_outcome AS ENUM (
    'content_removed',
    'account_banned',
    'warning_given',
    'content_warning_added',
    'no_violation',
    'duplicate',
    'insufficient_information',
    'target_gone',
    'other'
);


--
-- Name: report_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_status AS ENUM (
    'open',
    'in_progress',
    'closed'
);


--
-- Name: report_target_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_target_type AS ENUM (
    'writing_group',
    'writing_thread',
    'writing_post',
    'writing_page',
    'story_idea',
    'chat_group',
    'chat_message',
    'user',
    'forum_post'
);


--
-- Name: story_content_warning; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.story_content_warning AS ENUM (
    'violence',
    'sexual_content',
    'self_harm',
    'suicide',
    'death',
    'grief',
    'abuse',
    'sexual_violence',
    'substance_abuse',
    'eating_disorder',
    'mental_illness',
    'discrimination',
    'gore',
    'war',
    'animal_cruelty',
    'pregnancy_loss'
);


--
-- Name: story_genre; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.story_genre AS ENUM (
    'action',
    'adventure',
    'comedy',
    'crime',
    'drama',
    'fantasy',
    'historical',
    'horror',
    'literary',
    'mystery',
    'retelling',
    'romance',
    'science_fiction',
    'slice_of_life',
    'thriller',
    'western'
);


--
-- Name: story_idea_party_size; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.story_idea_party_size AS ENUM (
    'one_on_one',
    'group'
);


--
-- Name: story_idea_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.story_idea_status AS ENUM (
    'open',
    'closed'
);


--
-- Name: story_language; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.story_language AS ENUM (
    'german',
    'english'
);


--
-- Name: story_perspective; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.story_perspective AS ENUM (
    'first_person',
    'second_person',
    'third_person_limited',
    'third_person_omniscient',
    'mixed'
);


--
-- Name: story_subgenre; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.story_subgenre AS ENUM (
    'high_fantasy',
    'dark_fantasy',
    'urban_fantasy',
    'portal_fantasy',
    'fairy_tale',
    'mythic_fantasy',
    'paranormal_fantasy',
    'time_travel_fantasy',
    'space_opera',
    'cyberpunk',
    'dystopian',
    'post_apocalyptic',
    'time_travel',
    'first_contact',
    'retold_book',
    'retold_movie',
    'retold_myth',
    'retold_saga',
    'retold_manga',
    'contemporary_romance',
    'historical_romance',
    'romantic_fantasy',
    'forbidden_romance',
    'cosy_romance',
    'comedy_romance',
    'closed_door_romance',
    'erotic_romance',
    'intrigue',
    'detective',
    'cosy_mystery',
    'noir',
    'whodunit',
    'heist',
    'organised_crime',
    'police_procedural',
    'psychological_thriller',
    'spy_thriller',
    'legal_thriller',
    'survival_thriller',
    'gothic_horror',
    'supernatural_horror',
    'psychological_horror',
    'creature_horror',
    'body_horror',
    'doll_horror',
    'ancient_world',
    'medieval',
    'early_modern',
    'victorian',
    'world_war',
    'twentieth_century',
    'quest',
    'exploration',
    'treasure_hunt',
    'survival_adventure',
    'military_action',
    'martial_arts',
    'superhero',
    'spy_action',
    'romantic_comedy',
    'satire',
    'parody',
    'dark_comedy',
    'family_drama',
    'coming_of_age',
    'tragedy',
    'everyday_life',
    'workplace',
    'school_life',
    'university_life',
    'family_life',
    'vacation',
    'classic_western',
    'weird_western',
    'magical_realism',
    'experimental'
);


--
-- Name: story_tense; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.story_tense AS ENUM (
    'past',
    'present',
    'mixed'
);


--
-- Name: story_trope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.story_trope AS ENUM (
    'enemies_to_lovers',
    'friends_to_lovers',
    'friends_with_benefits',
    'slow_burn',
    'forbidden_love',
    'love_triangle',
    'fake_relationship',
    'second_chance',
    'found_family',
    'chosen_one',
    'mentor_and_student',
    'rivals',
    'redemption_arc',
    'villain_to_hero',
    'hero_to_villain',
    'hidden_identity',
    'secret_heritage',
    'amnesia',
    'time_loop',
    'quest_for_an_artefact',
    'heist_crew',
    'locked_room',
    'forced_proximity',
    'grumpy_and_sunshine',
    'unreliable_narrator',
    'epistolary',
    'multiple_timelines',
    'ensemble_cast',
    'morally_grey_protagonist',
    'road_trip',
    'court_intrigue'
);


--
-- Name: strike_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.strike_action AS ENUM (
    'warning',
    'suspension',
    'deletion'
);


--
-- Name: strike_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.strike_severity AS ENUM (
    'acceptable',
    'borderline',
    'severe'
);


--
-- Name: user_in_chat_group_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_in_chat_group_status AS ENUM (
    'invited',
    'joined'
);


--
-- Name: user_in_writing_group_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_in_writing_group_role AS ENUM (
    'administrator',
    'writer',
    'reader'
);


--
-- Name: user_in_writing_group_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_in_writing_group_status AS ENUM (
    'invited',
    'joined'
);


--
-- Name: user_token_purpose; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_token_purpose AS ENUM (
    'password_reset',
    'email_address_verification',
    'email_address_change',
    'account_deletion'
);


--
-- Name: writing_group_story_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.writing_group_story_status AS ENUM (
    'planning',
    'writing',
    'finished'
);


--
-- Name: writing_group_visibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.writing_group_visibility AS ENUM (
    'public',
    'private'
);


--
-- Name: delete_chat_group_after_last_user_leaves(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_chat_group_after_last_user_leaves() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    -- Two members leaving at once would otherwise each still see the other's row, so neither
    -- deletes and the chat is left with nobody in it. Taking the row lock first serialises
    -- them; the DELETE below is a separate statement and so re-reads.
    PERFORM 1
    FROM public.chat_group
    WHERE id = OLD.chat_group_id
        FOR UPDATE;

    DELETE
    FROM public.chat_group AS cg
    WHERE cg.id = OLD.chat_group_id
      AND NOT EXISTS (SELECT true FROM public.user_in_chat_group AS uicg WHERE uicg.chat_group_id = cg.id);

    RETURN NULL;
END;
$$;


--
-- Name: delete_writing_group_after_last_user_leaves(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_writing_group_after_last_user_leaves() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    -- Two members leaving at once would otherwise each still see the other's row, so neither
    -- deletes and the group is left with nobody in it. Taking the groups' row locks first
    -- serialises them; the DELETE below is a separate statement and so re-reads, seeing the
    -- other transaction's committed departure rather than this one's original snapshot.
    PERFORM 1
    FROM public.writing_group
    WHERE id = OLD.writing_group_id
        FOR UPDATE;

    DELETE
    FROM public.writing_group AS wg
    WHERE wg.id = OLD.writing_group_id
      AND NOT EXISTS (SELECT true FROM public.user_in_writing_group AS uiwg WHERE uiwg.writing_group_id = wg.id);

    RETURN NULL;
END;
$$;


--
-- Name: set_invited_joined_at_for_user_in_chat_group(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_invited_joined_at_for_user_in_chat_group() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        NEW.invited_at = now();

        IF NEW.status = 'joined' THEN
            NEW.joined_at = now();
        END IF;

    ELSIF NEW.status = 'joined' AND OLD.status IS DISTINCT FROM 'joined' THEN
        NEW.joined_at = now();

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: set_invited_joined_at_for_user_in_writing_group(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_invited_joined_at_for_user_in_writing_group() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        NEW.invited_at = now();

        IF NEW.status = 'joined' THEN
            NEW.joined_at = now();
        END IF;

    ELSIF NEW.status = 'joined' AND OLD.status IS DISTINCT FROM 'joined' THEN
        NEW.joined_at = now();

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: set_last_activity_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_last_activity_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    IF OLD IS DISTINCT FROM NEW THEN
        NEW.last_activity_at = now();
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: set_last_activity_at_for_chat_group(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_last_activity_at_for_chat_group() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        UPDATE public.chat_group
        SET last_activity_at = now()
        WHERE id = OLD.chat_group_id;

    ELSE
        UPDATE public.chat_group
        SET last_activity_at = now()
        WHERE id = NEW.chat_group_id;

    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: set_last_activity_at_for_forum_thread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_last_activity_at_for_forum_thread() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        UPDATE public.forum_thread
        SET last_activity_at = now()
        WHERE id = OLD.forum_thread_id;
    ELSE
        UPDATE public.forum_thread
        SET last_activity_at = now()
        WHERE id = NEW.forum_thread_id;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: set_last_activity_at_for_writing_group(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_last_activity_at_for_writing_group() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        UPDATE public.writing_group
        SET last_activity_at = now()
        WHERE id = OLD.writing_group_id;

    ELSE
        UPDATE public.writing_group
        SET last_activity_at = now()
        WHERE id = NEW.writing_group_id;

    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: set_last_activity_at_for_writing_thread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_last_activity_at_for_writing_thread() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        IF OLD.is_draft THEN
            RETURN NULL;
        END IF;

        UPDATE public.writing_thread
        SET last_activity_at = now()
        WHERE id = OLD.writing_thread_id;

    ELSE
        IF NEW.is_draft THEN
            RETURN NULL;
        END IF;

        UPDATE public.writing_thread
        SET last_activity_at = now()
        WHERE id = NEW.writing_thread_id;

    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
    IF OLD IS DISTINCT FROM NEW THEN
        NEW.updated_at = now();
    END IF;

    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_window; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_window (
    user_id uuid NOT NULL,
    window_start timestamp with time zone NOT NULL
);


--
-- Name: banned_ip; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banned_ip (
    ip_address text NOT NULL,
    banned_at timestamp with time zone DEFAULT now() NOT NULL,
    banned_by uuid,
    reason text NOT NULL
);


--
-- Name: blind_date_application; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blind_date_application (
    id uuid DEFAULT uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    status public.blind_date_application_status DEFAULT 'pending'::public.blind_date_application_status NOT NULL,
    offer_id uuid,
    plot_title text NOT NULL,
    writing_style public.blind_date_writing_style NOT NULL,
    post_length public.blind_date_post_length NOT NULL,
    role_gender text NOT NULL,
    pairing text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    decision_note text,
    CONSTRAINT blind_date_application_decision_is_complete CHECK ((((status = 'pending'::public.blind_date_application_status) AND (decided_at IS NULL)) OR ((status <> 'pending'::public.blind_date_application_status) AND (decided_at IS NOT NULL)))),
    CONSTRAINT blind_date_application_pairing_check CHECK ((btrim(pairing) <> ''::text)),
    CONSTRAINT blind_date_application_plot_title_check CHECK ((btrim(plot_title) <> ''::text)),
    CONSTRAINT blind_date_application_role_gender_check CHECK ((btrim(role_gender) <> ''::text))
);


--
-- Name: blind_date_exclusion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blind_date_exclusion (
    user_id uuid NOT NULL,
    reason text NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blind_date_exclusion_reason_check CHECK ((btrim(reason) <> ''::text))
);


--
-- Name: blind_date_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blind_date_feedback (
    id uuid DEFAULT uuidv7() NOT NULL,
    pair_id uuid NOT NULL,
    user_id uuid NOT NULL,
    worked public.blind_date_verdict,
    again public.blind_date_again,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blind_date_feedback_answered_or_declined CHECK ((((worked IS NULL) = (again IS NULL)) AND ((worked IS NOT NULL) OR (note IS NULL))))
);


--
-- Name: blind_date_name_suspicion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blind_date_name_suspicion (
    id uuid DEFAULT uuidv7() NOT NULL,
    report_id uuid NOT NULL,
    pair_id uuid NOT NULL,
    writing_post_id uuid,
    suspected_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    confirmed boolean,
    CONSTRAINT blind_date_name_suspicion_resolution_is_complete CHECK (((resolved_at IS NULL) = (confirmed IS NULL)))
);


--
-- Name: blind_date_offer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blind_date_offer (
    id uuid DEFAULT uuidv7() NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    roles text[] DEFAULT '{}'::text[] NOT NULL,
    closes_at timestamp with time zone,
    pairing public.blind_date_pairing,
    genres text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT blind_date_offer_description_check CHECK ((btrim(description) <> ''::text)),
    CONSTRAINT blind_date_offer_genres_are_named CHECK ((''::text <> ALL (genres))),
    CONSTRAINT blind_date_offer_roles_are_named CHECK ((''::text <> ALL (roles))),
    CONSTRAINT blind_date_offer_title_check CHECK ((btrim(title) <> ''::text))
);


--
-- Name: blind_date_pair; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blind_date_pair (
    id uuid DEFAULT uuidv7() NOT NULL,
    writing_group_id uuid NOT NULL,
    matched_at timestamp with time zone DEFAULT now() NOT NULL,
    matched_by uuid,
    revealed_at timestamp with time zone,
    rpg_thread_id uuid,
    exchange_thread_id uuid,
    ended_at timestamp with time zone,
    ended_reason text,
    ended_by uuid,
    CONSTRAINT blind_date_pair_ended_by_needs_an_ending CHECK (((ended_by IS NULL) OR (ended_at IS NOT NULL))),
    CONSTRAINT blind_date_pair_ending_is_one_thing CHECK ((((revealed_at IS NULL) OR (ended_at IS NULL)) AND ((ended_at IS NULL) = (ended_reason IS NULL))))
);


--
-- Name: blind_date_partner; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blind_date_partner (
    pair_id uuid NOT NULL,
    user_id uuid NOT NULL,
    application_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    wants_reveal_at timestamp with time zone
);


--
-- Name: blocked_email_domain; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blocked_email_domain (
    domain text NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    note text
);


--
-- Name: blocked_word; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blocked_word (
    word text NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    CONSTRAINT blocked_word_word_check CHECK (((word = lower(word)) AND (btrim(word) = word) AND (length(word) >= 2)))
);


--
-- Name: chat_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_group (
    id uuid DEFAULT uuidv7() NOT NULL,
    title text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_message; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_message (
    id uuid DEFAULT uuidv7() NOT NULL,
    chat_group_id uuid NOT NULL,
    text text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: custom_page; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_page (
    slug text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_edited_by uuid
);


--
-- Name: favourite; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favourite (
    id uuid DEFAULT uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    writing_group_id uuid,
    writing_thread_id uuid,
    writing_post_id uuid,
    writing_page_id uuid,
    story_idea_id uuid,
    chat_group_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    forum_post_id uuid,
    CONSTRAINT favourite_names_exactly_one_thing CHECK ((num_nonnulls(writing_group_id, writing_thread_id, writing_post_id, writing_page_id, story_idea_id, chat_group_id, forum_post_id) = 1))
);


--
-- Name: forum_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_category (
    id uuid DEFAULT uuidv7() NOT NULL,
    title text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: forum_post; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_post (
    id uuid DEFAULT uuidv7() NOT NULL,
    forum_thread_id uuid NOT NULL,
    document jsonb NOT NULL,
    text text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone,
    edited_by uuid
);


--
-- Name: forum_thread; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_thread (
    id uuid DEFAULT uuidv7() NOT NULL,
    sub_forum_id uuid NOT NULL,
    title text NOT NULL,
    visibility public.forum_visibility,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification (
    id uuid DEFAULT uuidv7() NOT NULL,
    recipient_id uuid NOT NULL,
    type public.notification_type NOT NULL,
    actor_id uuid,
    writing_group_id uuid,
    chat_group_id uuid,
    writing_thread_id uuid,
    writing_page_id uuid,
    writing_post_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    CONSTRAINT notification_actor_is_not_recipient CHECK ((actor_id IS DISTINCT FROM recipient_id)),
    CONSTRAINT notification_subject_matches_type CHECK (
CASE type
    WHEN 'blind_date_matched'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
    WHEN 'blind_date_reveal_requested'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
    WHEN 'blind_date_ended'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
    WHEN 'invited_to_writing_group'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
    WHEN 'invitation_accepted'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
    WHEN 'visibility_changed_in_writing_group'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
    WHEN 'role_changed_in_writing_group'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
    WHEN 'new_writing_thread'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NOT NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
    WHEN 'new_writing_post'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NOT NULL) AND (writing_post_id IS NOT NULL) AND (writing_page_id IS NULL))
    WHEN 'new_writing_page'::public.notification_type THEN ((writing_group_id IS NOT NULL) AND (chat_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NOT NULL))
    WHEN 'invited_to_chat_group'::public.notification_type THEN ((chat_group_id IS NOT NULL) AND (writing_group_id IS NULL) AND (writing_thread_id IS NULL) AND (writing_post_id IS NULL) AND (writing_page_id IS NULL))
    ELSE false
END)
);


--
-- Name: profile_answer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_answer (
    user_id uuid NOT NULL,
    question_id uuid NOT NULL,
    answer_text text,
    option_id uuid,
    CONSTRAINT profile_answer_is_one_kind CHECK ((((answer_text IS NOT NULL) AND (option_id IS NULL)) OR ((answer_text IS NULL) AND (option_id IS NOT NULL))))
);


--
-- Name: profile_question; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_question (
    id uuid DEFAULT uuidv7() NOT NULL,
    section text NOT NULL,
    prompt text NOT NULL,
    kind public.profile_question_kind NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);


--
-- Name: profile_question_option; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_question_option (
    id uuid DEFAULT uuidv7() NOT NULL,
    question_id uuid NOT NULL,
    label text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);


--
-- Name: report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report (
    id uuid DEFAULT uuidv7() NOT NULL,
    reporter_id uuid,
    target_type public.report_target_type NOT NULL,
    reported_writing_group_id uuid,
    reported_writing_thread_id uuid,
    reported_writing_post_id uuid,
    reported_writing_page_id uuid,
    reported_story_idea_id uuid,
    reported_chat_group_id uuid,
    reported_chat_message_id uuid,
    reported_user_id uuid,
    reported_author_id uuid,
    target_excerpt text NOT NULL,
    category public.report_category NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    operator_id uuid,
    in_progress_at timestamp with time zone,
    closed_at timestamp with time zone,
    closing_outcome public.report_outcome,
    closing_note text,
    status public.report_status GENERATED ALWAYS AS (
CASE
    WHEN (closed_at IS NOT NULL) THEN 'closed'::public.report_status
    WHEN (in_progress_at IS NOT NULL) THEN 'in_progress'::public.report_status
    ELSE 'open'::public.report_status
END) STORED NOT NULL,
    reported_forum_post_id uuid,
    CONSTRAINT report_closed_after_taken CHECK (((in_progress_at IS NULL) OR (closed_at IS NULL) OR (closed_at >= in_progress_at))),
    CONSTRAINT report_closed_has_an_outcome CHECK ((((closed_at IS NOT NULL) AND (closing_outcome IS NOT NULL) AND (closing_note IS NOT NULL)) OR ((closed_at IS NULL) AND (closing_outcome IS NULL) AND (closing_note IS NULL)))),
    CONSTRAINT report_target_matches_type CHECK (
CASE target_type
    WHEN 'writing_group'::public.report_target_type THEN (num_nonnulls(reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0)
    WHEN 'writing_thread'::public.report_target_type THEN (num_nonnulls(reported_writing_group_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0)
    WHEN 'writing_post'::public.report_target_type THEN (num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0)
    WHEN 'writing_page'::public.report_target_type THEN (num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0)
    WHEN 'story_idea'::public.report_target_type THEN (num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0)
    WHEN 'chat_group'::public.report_target_type THEN (num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 0)
    WHEN 'chat_message'::public.report_target_type THEN (num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_user_id, reported_forum_post_id) = 0)
    WHEN 'user'::public.report_target_type THEN (num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_forum_post_id) = 0)
    WHEN 'forum_post'::public.report_target_type THEN (num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id) = 0)
    ELSE false
END)
);


--
-- Name: status_update; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_update (
    id uuid DEFAULT uuidv7() NOT NULL,
    created_by uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: status_update_comment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_update_comment (
    id uuid DEFAULT uuidv7() NOT NULL,
    status_update_id uuid NOT NULL,
    created_by uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: story_idea; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.story_idea (
    id uuid DEFAULT uuidv7() NOT NULL,
    title text NOT NULL,
    subtitle text,
    teaser text NOT NULL,
    synopsis text NOT NULL,
    genres public.story_genre[] DEFAULT '{}'::public.story_genre[] NOT NULL,
    subgenres public.story_subgenre[] DEFAULT '{}'::public.story_subgenre[] NOT NULL,
    tropes public.story_trope[] DEFAULT '{}'::public.story_trope[] NOT NULL,
    content_warnings public.story_content_warning[] DEFAULT '{}'::public.story_content_warning[] NOT NULL,
    story_themes text,
    story_settings text,
    tense public.story_tense,
    perspective public.story_perspective,
    language public.story_language DEFAULT 'german'::public.story_language NOT NULL,
    looking_for text,
    party_size public.story_idea_party_size,
    status public.story_idea_status DEFAULT 'open'::public.story_idea_status NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: story_idea_reader; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.story_idea_reader (
    story_idea_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: strike; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.strike (
    id uuid DEFAULT uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    severity public.strike_severity NOT NULL,
    action public.strike_action NOT NULL,
    reason text NOT NULL,
    suspended_until timestamp with time zone,
    issued_by uuid,
    issued_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sub_forum; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_forum (
    id uuid DEFAULT uuidv7() NOT NULL,
    category_id uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    visibility public.forum_visibility DEFAULT 'members'::public.forum_visibility NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id uuid DEFAULT uuidv7() NOT NULL,
    username text NOT NULL,
    hashed_password text NOT NULL,
    email_address text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email_address_verified_at timestamp with time zone,
    platform_role public.platform_role,
    banned_at timestamp with time zone,
    banned_by uuid,
    ban_reason text,
    about_me text,
    writing_style text,
    post_length text,
    writing_frequency text,
    co_writer_expectations text,
    writing_boundaries text,
    genres text,
    suspended_until timestamp with time zone,
    suspension_reason text,
    invited_by uuid,
    is_primordial_admin boolean DEFAULT false NOT NULL,
    may_manage_blind_date boolean DEFAULT false NOT NULL,
    CONSTRAINT user_ban_is_complete CHECK ((((banned_at IS NULL) AND (ban_reason IS NULL) AND (banned_by IS NULL)) OR ((banned_at IS NOT NULL) AND (ban_reason IS NOT NULL)))),
    CONSTRAINT user_primordial_admin_is_an_administrator CHECK (((NOT is_primordial_admin) OR (NOT (platform_role IS DISTINCT FROM 'administrator'::public.platform_role)))),
    CONSTRAINT user_suspension_is_complete CHECK ((((suspended_until IS NULL) AND (suspension_reason IS NULL)) OR ((suspended_until IS NOT NULL) AND (suspension_reason IS NOT NULL))))
);


--
-- Name: user_avatar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_avatar (
    user_id uuid NOT NULL,
    file_id uuid DEFAULT uuidv7() NOT NULL,
    origin public.avatar_origin NOT NULL,
    credit text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_avatar_credits_what_is_not_its_own CHECK (((origin = 'own_work'::public.avatar_origin) OR (credit IS NOT NULL)))
);


--
-- Name: user_block; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_block (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_block_not_self CHECK ((blocker_id <> blocked_id))
);


--
-- Name: user_in_chat_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_in_chat_group (
    user_id uuid NOT NULL,
    chat_group_id uuid NOT NULL,
    status public.user_in_chat_group_status NOT NULL,
    invited_at timestamp with time zone,
    joined_at timestamp with time zone,
    last_read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_in_writing_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_in_writing_group (
    user_id uuid NOT NULL,
    writing_group_id uuid NOT NULL,
    role public.user_in_writing_group_role NOT NULL,
    status public.user_in_writing_group_status NOT NULL,
    invited_at timestamp with time zone,
    joined_at timestamp with time zone,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_session (
    id uuid DEFAULT uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    hashed_token bytea NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    user_agent text,
    ip_address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_token (
    id uuid DEFAULT uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    purpose public.user_token_purpose NOT NULL,
    hashed_token bytea NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    new_email_address text,
    CONSTRAINT user_token_new_email_address_matches_purpose CHECK (
CASE purpose
    WHEN 'email_address_change'::public.user_token_purpose THEN (new_email_address IS NOT NULL)
    WHEN 'password_reset'::public.user_token_purpose THEN (new_email_address IS NULL)
    WHEN 'email_address_verification'::public.user_token_purpose THEN (new_email_address IS NULL)
    WHEN 'account_deletion'::public.user_token_purpose THEN (new_email_address IS NULL)
    ELSE false
END)
);


--
-- Name: watchlist_entry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchlist_entry (
    user_id uuid NOT NULL,
    note text NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: writing_folder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.writing_folder (
    id uuid DEFAULT uuidv7() NOT NULL,
    writing_group_id uuid NOT NULL,
    parent_folder_id uuid,
    depth smallint NOT NULL,
    title text NOT NULL,
    description text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT writing_folder_depth_check CHECK (((depth >= 1) AND (depth <= 5)))
);


--
-- Name: writing_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.writing_group (
    id uuid DEFAULT uuidv7() NOT NULL,
    title text NOT NULL,
    subtitle text,
    synopsis text NOT NULL,
    visibility public.writing_group_visibility DEFAULT 'private'::public.writing_group_visibility NOT NULL,
    story_status public.writing_group_story_status DEFAULT 'planning'::public.writing_group_story_status NOT NULL,
    genres public.story_genre[] DEFAULT '{}'::public.story_genre[] NOT NULL,
    subgenres public.story_subgenre[] DEFAULT '{}'::public.story_subgenre[] NOT NULL,
    tropes public.story_trope[] DEFAULT '{}'::public.story_trope[] NOT NULL,
    content_warnings public.story_content_warning[] DEFAULT '{}'::public.story_content_warning[] NOT NULL,
    story_themes text,
    story_settings text,
    tense public.story_tense,
    perspective public.story_perspective,
    language public.story_language DEFAULT 'german'::public.story_language NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    authors_are_pseudonymous boolean DEFAULT false NOT NULL
);


--
-- Name: writing_group_next_step; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.writing_group_next_step (
    id uuid DEFAULT uuidv7() NOT NULL,
    writing_group_id uuid NOT NULL,
    text text NOT NULL,
    created_by uuid,
    completed_at timestamp with time zone,
    completed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT writing_group_next_step_completer_needs_time CHECK (((completed_by IS NULL) OR (completed_at IS NOT NULL)))
);


--
-- Name: writing_page; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.writing_page (
    id uuid DEFAULT uuidv7() NOT NULL,
    writing_group_id uuid NOT NULL,
    title text NOT NULL,
    document jsonb NOT NULL,
    text text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    folder_id uuid
);


--
-- Name: writing_post; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.writing_post (
    id uuid DEFAULT uuidv7() NOT NULL,
    writing_thread_id uuid NOT NULL,
    document jsonb NOT NULL,
    text text NOT NULL,
    is_draft boolean NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone,
    edited_by uuid,
    CONSTRAINT writing_post_editor_needs_time CHECK (((edited_by IS NULL) OR (edited_at IS NOT NULL)))
);


--
-- Name: writing_thread; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.writing_thread (
    id uuid DEFAULT uuidv7() NOT NULL,
    writing_group_id uuid NOT NULL,
    title text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    folder_id uuid
);


--
-- Data for Name: activity_window; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: banned_ip; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: blind_date_application; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: blind_date_exclusion; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: blind_date_feedback; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: blind_date_name_suspicion; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: blind_date_offer; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: blind_date_pair; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: blind_date_partner; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: blocked_email_domain; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.blocked_email_domain VALUES ('10minutemail.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('10minutemail.net', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('10minutemail.de', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('20minutemail.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('guerrillamail.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('guerrillamail.net', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('guerrillamail.org', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('guerrillamail.biz', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('sharklasers.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('mailinator.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('mailinator.net', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('mailinator.org', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('tempmail.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('temp-mail.org', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('tempmail.net', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('throwawaymail.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('trashmail.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('trashmail.de', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('trash-mail.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('yopmail.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('yopmail.net', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('yopmail.fr', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('fakeinbox.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('mintemail.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('getnada.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('moakt.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('dispostable.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('mohmal.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('emailondeck.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('maildrop.cc', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('mail-temporaire.fr', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('wegwerfmail.de', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('wegwerfemail.de', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('einrot.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('spambog.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('spamgourmet.com', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');
INSERT INTO public.blocked_email_domain VALUES ('byom.de', NULL, '2026-09-04 15:54:38.733079+00', 'Bekannter Wegwerf-Mail-Anbieter');


--
-- Data for Name: blocked_word; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: chat_group; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: chat_message; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: custom_page; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.custom_page VALUES ('blind-date', 'Blind-Date', 'Zwei Menschen schreiben miteinander, ohne zu wissen, wer der andere ist. Erst wenn ihr es beide wollt, gebt ihr euch zu erkennen.

Die Anonymität ist der ganze Sinn: Sie sorgt dafür, dass man sich auf Menschen einlässt, mit denen man sonst vielleicht nie geschrieben hätte. Innerhalb der Gruppe heißt ihr „Blind-Date-Partner 1" und „Blind-Date-Partner 2" — auch in Benachrichtigungen.

Bewerben kannst du dich rechts über das Formular: entweder auf eine der ausgeschriebenen Handlungen, oder mit einer beliebigen offiziellen RSH-Handlung, die du selbst nennst.', true, '2026-09-04 15:54:39.1627+00', '2026-09-04 15:54:39.1627+00', NULL);
INSERT INTO public.custom_page VALUES ('blind-date-regelwerk', 'Blind-Date — Regelwerk', '1§ TEILNAHMEBEDINGUNGEN

1.1 Die Teilnahme am Blind-Date ist nur dann möglich, wenn du innerhalb der letzten dreißig Tage mindestens 1000 Online-Minuten aufweisen kannst. In den ersten drei Monaten nach Einführung dieses Features gilt diese Bedingung noch nicht — jede und jeder darf sich in dieser Zeit bewerben.

1.2 Du kannst dich auf eine der aktuell angebotenen Handlungen bewerben, oder proaktiv eine eigene offizielle RSH-Handlung als Blind-Date vorschlagen.

2§ PARTNERZUTEILUNG

2.1 Wenn du dich für das Blind-Date anmeldest, schmeißt du alle Vorurteile über Bord, die du manch anderen User:innen gegenüber vielleicht hast. Wir möchten verhindern, dass zugeteilte Partner:innen direkt abgelehnt werden, daher werden die Blind-Date-Schreiber:innen mit einem Pseudonym angezeigt.

2.2 Innerhalb des Blind-Dates schreibt ihr ausschließlich über eure Pseudonyme; einen privaten Chat zwischen „Blind-Date-Partner 1“ und „Blind-Date-Partner 2“ gibt es nicht. Außerhalb seid ihr gewöhnliche Mitglieder und könnt einander schreiben wie allen anderen auch — ihr wisst dabei nur nicht, wer die andere Person im Blind-Date ist. Eure Identität gebt ihr einander ausschließlich über die gemeinsame Enthüllung preis (siehe 2.3), niemals einseitig.

2.3 Eine Enthüllung der eigenen Identität ist erst möglich, wenn 50 gemeinsame Beiträge im eigentlichen Rollenspiel-Thread zusammengekommen sind, und nur wenn beide Beteiligten zustimmen. Niemand soll gespoilert werden, der:die es nicht möchte.

2.4 Versucht eine oder versuchen beide beteiligte Personen, sich im Austausch-Thread zu erkennen zu geben, wird das automatisch an die Moderation gemeldet. Bestätigt sich der Verdacht, wird das Blind-Date beendet, die betroffene Person von künftigen Blind-Dates ausgeschlossen und per E-Mail informiert. Stellt sich der Verdacht als unbegründet heraus (z.B. weil ein Wort zufällig wie ein Nutzername klingt), läuft das Blind-Date unverändert weiter.

3§ WEITERE BLIND-DATES

3.1 Es ist immer nur ein aktives Blind-Date gleichzeitig pro Mitglied erlaubt. Nach einer Enthüllung oder Beendigung darf ein neues Blind-Date angefragt werden.

4§ ENTHÜLLUNG UND BEENDIGUNG

4.1 Ein Blind-Date kann auf zwei Arten enden: durch Enthüllung (beide stimmen zu, die Anonymität fällt, dieselbe Gruppe besteht unter echten Namen weiter) oder durch Beendigung ohne Enthüllung (z.B. bei Inaktivität oder auf eigenen Wunsch — die gewohnte 4-Monats-Regel für inaktive Gruppen gilt auch hier).

4.2 Bitte gebt dem Abenteuer nach der Anmeldung auch wirklich eine Chance und werft nicht direkt nach wenigen Tagen das Handtuch — bringt etwas Geduld, Flexibilität und Durchhaltevermögen mit.

4.3 Nach jeder Beendigung erhaltet ihr ein kurzes, freiwilliges Formular, in dem ihr das Blind-Date bewerten könnt. Wir sind dankbar für euer Feedback, um das Format bei Bedarf zu verbessern.', true, '2026-09-04 15:54:39.1627+00', '2026-09-04 15:54:39.1627+00', NULL);


--
-- Data for Name: favourite; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: forum_category; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: forum_post; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: forum_thread; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: notification; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: profile_answer; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: profile_question; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: profile_question_option; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: report; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: status_update; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: status_update_comment; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: story_idea; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: story_idea_reader; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: strike; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sub_forum; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_avatar; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_block; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_in_chat_group; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_in_writing_group; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_session; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_token; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: watchlist_entry; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: writing_folder; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: writing_group; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: writing_group_next_step; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: writing_page; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: writing_post; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: writing_thread; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Name: activity_window activity_window_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_window
    ADD CONSTRAINT activity_window_pkey PRIMARY KEY (user_id, window_start);


--
-- Name: banned_ip banned_ip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banned_ip
    ADD CONSTRAINT banned_ip_pkey PRIMARY KEY (ip_address);


--
-- Name: blind_date_application blind_date_application_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_application
    ADD CONSTRAINT blind_date_application_pkey PRIMARY KEY (id);


--
-- Name: blind_date_exclusion blind_date_exclusion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_exclusion
    ADD CONSTRAINT blind_date_exclusion_pkey PRIMARY KEY (user_id);


--
-- Name: blind_date_feedback blind_date_feedback_once_per_member; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_feedback
    ADD CONSTRAINT blind_date_feedback_once_per_member UNIQUE (pair_id, user_id);


--
-- Name: blind_date_feedback blind_date_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_feedback
    ADD CONSTRAINT blind_date_feedback_pkey PRIMARY KEY (id);


--
-- Name: blind_date_name_suspicion blind_date_name_suspicion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_name_suspicion
    ADD CONSTRAINT blind_date_name_suspicion_pkey PRIMARY KEY (id);


--
-- Name: blind_date_name_suspicion blind_date_name_suspicion_report_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_name_suspicion
    ADD CONSTRAINT blind_date_name_suspicion_report_id_key UNIQUE (report_id);


--
-- Name: blind_date_offer blind_date_offer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_offer
    ADD CONSTRAINT blind_date_offer_pkey PRIMARY KEY (id);


--
-- Name: blind_date_pair blind_date_pair_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_pair
    ADD CONSTRAINT blind_date_pair_pkey PRIMARY KEY (id);


--
-- Name: blind_date_pair blind_date_pair_writing_group_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_pair
    ADD CONSTRAINT blind_date_pair_writing_group_id_key UNIQUE (writing_group_id);


--
-- Name: blind_date_partner blind_date_partner_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_partner
    ADD CONSTRAINT blind_date_partner_pkey PRIMARY KEY (pair_id, user_id);


--
-- Name: blocked_email_domain blocked_email_domain_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocked_email_domain
    ADD CONSTRAINT blocked_email_domain_pkey PRIMARY KEY (domain);


--
-- Name: blocked_word blocked_word_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocked_word
    ADD CONSTRAINT blocked_word_pkey PRIMARY KEY (word);


--
-- Name: chat_group chat_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_group
    ADD CONSTRAINT chat_group_pkey PRIMARY KEY (id);


--
-- Name: chat_message chat_message_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message
    ADD CONSTRAINT chat_message_pkey PRIMARY KEY (id);


--
-- Name: custom_page custom_page_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_page
    ADD CONSTRAINT custom_page_pkey PRIMARY KEY (slug);


--
-- Name: favourite favourite_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourite
    ADD CONSTRAINT favourite_pkey PRIMARY KEY (id);


--
-- Name: forum_category forum_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_category
    ADD CONSTRAINT forum_category_pkey PRIMARY KEY (id);


--
-- Name: forum_post forum_post_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_post
    ADD CONSTRAINT forum_post_pkey PRIMARY KEY (id);


--
-- Name: forum_thread forum_thread_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_thread
    ADD CONSTRAINT forum_thread_pkey PRIMARY KEY (id);


--
-- Name: notification notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_pkey PRIMARY KEY (id);


--
-- Name: profile_answer profile_answer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_answer
    ADD CONSTRAINT profile_answer_pkey PRIMARY KEY (user_id, question_id);


--
-- Name: profile_question_option profile_question_option_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_question_option
    ADD CONSTRAINT profile_question_option_pkey PRIMARY KEY (id);


--
-- Name: profile_question profile_question_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_question
    ADD CONSTRAINT profile_question_pkey PRIMARY KEY (id);


--
-- Name: report report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_pkey PRIMARY KEY (id);


--
-- Name: status_update_comment status_update_comment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_update_comment
    ADD CONSTRAINT status_update_comment_pkey PRIMARY KEY (id);


--
-- Name: status_update status_update_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_update
    ADD CONSTRAINT status_update_pkey PRIMARY KEY (id);


--
-- Name: story_idea story_idea_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_idea
    ADD CONSTRAINT story_idea_pkey PRIMARY KEY (id);


--
-- Name: story_idea_reader story_idea_reader_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_idea_reader
    ADD CONSTRAINT story_idea_reader_pkey PRIMARY KEY (story_idea_id, user_id);


--
-- Name: strike strike_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strike
    ADD CONSTRAINT strike_pkey PRIMARY KEY (id);


--
-- Name: sub_forum sub_forum_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_forum
    ADD CONSTRAINT sub_forum_pkey PRIMARY KEY (id);


--
-- Name: user_avatar user_avatar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_avatar
    ADD CONSTRAINT user_avatar_pkey PRIMARY KEY (user_id);


--
-- Name: user_block user_block_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_block
    ADD CONSTRAINT user_block_pkey PRIMARY KEY (blocker_id, blocked_id);


--
-- Name: user user_email_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_address_key UNIQUE (email_address);


--
-- Name: user_in_chat_group user_in_chat_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_in_chat_group
    ADD CONSTRAINT user_in_chat_group_pkey PRIMARY KEY (user_id, chat_group_id);


--
-- Name: user_in_writing_group user_in_writing_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_in_writing_group
    ADD CONSTRAINT user_in_writing_group_pkey PRIMARY KEY (user_id, writing_group_id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: user_session user_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT user_session_pkey PRIMARY KEY (id);


--
-- Name: user_token user_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_token
    ADD CONSTRAINT user_token_pkey PRIMARY KEY (id);


--
-- Name: user user_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_username_key UNIQUE (username);


--
-- Name: watchlist_entry watchlist_entry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_entry
    ADD CONSTRAINT watchlist_entry_pkey PRIMARY KEY (user_id);


--
-- Name: writing_folder writing_folder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_folder
    ADD CONSTRAINT writing_folder_pkey PRIMARY KEY (id);


--
-- Name: writing_group_next_step writing_group_next_step_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_group_next_step
    ADD CONSTRAINT writing_group_next_step_pkey PRIMARY KEY (id);


--
-- Name: writing_group writing_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_group
    ADD CONSTRAINT writing_group_pkey PRIMARY KEY (id);


--
-- Name: writing_page writing_page_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_page
    ADD CONSTRAINT writing_page_pkey PRIMARY KEY (id);


--
-- Name: writing_post writing_post_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_post
    ADD CONSTRAINT writing_post_pkey PRIMARY KEY (id);


--
-- Name: writing_thread writing_thread_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_thread
    ADD CONSTRAINT writing_thread_pkey PRIMARY KEY (id);


--
-- Name: banned_ip_banned_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX banned_ip_banned_by_idx ON public.banned_ip USING btree (banned_by) WHERE (banned_by IS NOT NULL);


--
-- Name: blind_date_application_one_pending_per_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX blind_date_application_one_pending_per_member_idx ON public.blind_date_application USING btree (user_id) WHERE (status = 'pending'::public.blind_date_application_status);


--
-- Name: blind_date_application_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blind_date_application_pending_idx ON public.blind_date_application USING btree (created_at) WHERE (status = 'pending'::public.blind_date_application_status);


--
-- Name: blind_date_feedback_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blind_date_feedback_pair_idx ON public.blind_date_feedback USING btree (pair_id);


--
-- Name: blind_date_name_suspicion_one_open_per_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX blind_date_name_suspicion_one_open_per_post_idx ON public.blind_date_name_suspicion USING btree (writing_post_id) WHERE ((resolved_at IS NULL) AND (writing_post_id IS NOT NULL));


--
-- Name: blind_date_name_suspicion_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blind_date_name_suspicion_open_idx ON public.blind_date_name_suspicion USING btree (created_at) WHERE (resolved_at IS NULL);


--
-- Name: blind_date_name_suspicion_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blind_date_name_suspicion_post_idx ON public.blind_date_name_suspicion USING btree (writing_post_id) WHERE (resolved_at IS NULL);


--
-- Name: blind_date_offer_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blind_date_offer_open_idx ON public.blind_date_offer USING btree (created_at DESC) WHERE (closed_at IS NULL);


--
-- Name: blind_date_partner_by_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blind_date_partner_by_user_idx ON public.blind_date_partner USING btree (user_id);


--
-- Name: blind_date_partner_one_active_per_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX blind_date_partner_one_active_per_member_idx ON public.blind_date_partner USING btree (user_id) WHERE is_active;


--
-- Name: chat_group_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_group_created_by_idx ON public.chat_group USING btree (created_by);


--
-- Name: chat_message_chat_group_id_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_message_chat_group_id_id_idx ON public.chat_message USING btree (chat_group_id, id DESC);


--
-- Name: chat_message_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_message_created_by_idx ON public.chat_message USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: favourite_chat_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favourite_chat_group_idx ON public.favourite USING btree (chat_group_id) WHERE (chat_group_id IS NOT NULL);


--
-- Name: favourite_forum_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favourite_forum_post_idx ON public.favourite USING btree (forum_post_id) WHERE (forum_post_id IS NOT NULL);


--
-- Name: favourite_one_per_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX favourite_one_per_member_idx ON public.favourite USING btree (user_id, writing_group_id, writing_thread_id, writing_post_id, writing_page_id, story_idea_id, chat_group_id, forum_post_id) NULLS NOT DISTINCT;


--
-- Name: favourite_story_idea_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favourite_story_idea_idx ON public.favourite USING btree (story_idea_id) WHERE (story_idea_id IS NOT NULL);


--
-- Name: favourite_writing_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favourite_writing_group_idx ON public.favourite USING btree (writing_group_id) WHERE (writing_group_id IS NOT NULL);


--
-- Name: favourite_writing_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favourite_writing_page_idx ON public.favourite USING btree (writing_page_id) WHERE (writing_page_id IS NOT NULL);


--
-- Name: favourite_writing_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favourite_writing_post_idx ON public.favourite USING btree (writing_post_id) WHERE (writing_post_id IS NOT NULL);


--
-- Name: favourite_writing_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favourite_writing_thread_idx ON public.favourite USING btree (writing_thread_id) WHERE (writing_thread_id IS NOT NULL);


--
-- Name: forum_category_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forum_category_position_idx ON public.forum_category USING btree ("position", id);


--
-- Name: forum_post_forum_thread_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forum_post_forum_thread_id_idx ON public.forum_post USING btree (forum_thread_id, created_at, id);


--
-- Name: forum_thread_sub_forum_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forum_thread_sub_forum_id_idx ON public.forum_thread USING btree (sub_forum_id, last_activity_at DESC, id);


--
-- Name: notification_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_actor_idx ON public.notification USING btree (actor_id) WHERE (actor_id IS NOT NULL);


--
-- Name: notification_one_role_change_per_membership; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_one_role_change_per_membership ON public.notification USING btree (recipient_id, writing_group_id) WHERE (type = 'role_changed_in_writing_group'::public.notification_type);


--
-- Name: notification_one_visibility_change_per_membership; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_one_visibility_change_per_membership ON public.notification USING btree (recipient_id, writing_group_id) WHERE (type = 'visibility_changed_in_writing_group'::public.notification_type);


--
-- Name: notification_recipient_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_recipient_id_occurred_at_idx ON public.notification USING btree (recipient_id, occurred_at DESC);


--
-- Name: notification_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_unread_idx ON public.notification USING btree (recipient_id) WHERE (read_at IS NULL);


--
-- Name: notification_writing_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_writing_post_idx ON public.notification USING btree (writing_post_id) WHERE (writing_post_id IS NOT NULL);


--
-- Name: notification_writing_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_writing_thread_idx ON public.notification USING btree (writing_thread_id) WHERE (writing_thread_id IS NOT NULL);


--
-- Name: profile_question_option_question_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_question_option_question_id_idx ON public.profile_question_option USING btree (question_id, "position");


--
-- Name: profile_question_section_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_question_section_idx ON public.profile_question USING btree (section, "position");


--
-- Name: report_one_open_per_reporter_and_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX report_one_open_per_reporter_and_category_idx ON public.report USING btree (reporter_id, category, reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) NULLS NOT DISTINCT WHERE ((closed_at IS NULL) AND (reporter_id IS NOT NULL) AND (num_nonnulls(reported_writing_group_id, reported_writing_thread_id, reported_writing_post_id, reported_writing_page_id, reported_story_idea_id, reported_chat_group_id, reported_chat_message_id, reported_user_id, reported_forum_post_id) = 1));


--
-- Name: report_operator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_operator_idx ON public.report USING btree (operator_id) WHERE (operator_id IS NOT NULL);


--
-- Name: report_reported_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reported_author_idx ON public.report USING btree (reported_author_id) WHERE (reported_author_id IS NOT NULL);


--
-- Name: report_reported_chat_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reported_chat_group_idx ON public.report USING btree (reported_chat_group_id) WHERE (reported_chat_group_id IS NOT NULL);


--
-- Name: report_reported_chat_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reported_chat_message_idx ON public.report USING btree (reported_chat_message_id) WHERE (reported_chat_message_id IS NOT NULL);


--
-- Name: report_reported_forum_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reported_forum_post_idx ON public.report USING btree (reported_forum_post_id) WHERE (reported_forum_post_id IS NOT NULL);


--
-- Name: report_reported_story_idea_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reported_story_idea_idx ON public.report USING btree (reported_story_idea_id) WHERE (reported_story_idea_id IS NOT NULL);


--
-- Name: report_reported_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reported_user_idx ON public.report USING btree (reported_user_id) WHERE (reported_user_id IS NOT NULL);


--
-- Name: report_reported_writing_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reported_writing_group_idx ON public.report USING btree (reported_writing_group_id) WHERE (reported_writing_group_id IS NOT NULL);


--
-- Name: report_reported_writing_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reported_writing_page_idx ON public.report USING btree (reported_writing_page_id) WHERE (reported_writing_page_id IS NOT NULL);


--
-- Name: report_reported_writing_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reported_writing_post_idx ON public.report USING btree (reported_writing_post_id) WHERE (reported_writing_post_id IS NOT NULL);


--
-- Name: report_reported_writing_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reported_writing_thread_idx ON public.report USING btree (reported_writing_thread_id) WHERE (reported_writing_thread_id IS NOT NULL);


--
-- Name: report_reporter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_reporter_idx ON public.report USING btree (reporter_id) WHERE (reporter_id IS NOT NULL);


--
-- Name: report_status_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_status_category_idx ON public.report USING btree (status, category);


--
-- Name: report_status_closing_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_status_closing_outcome_idx ON public.report USING btree (status, closing_outcome);


--
-- Name: report_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_status_created_idx ON public.report USING btree (status, created_at DESC);


--
-- Name: status_update_comment_status_update_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX status_update_comment_status_update_id_idx ON public.status_update_comment USING btree (status_update_id, created_at);


--
-- Name: status_update_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX status_update_created_at_idx ON public.status_update USING btree (created_at DESC);


--
-- Name: story_idea_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX story_idea_created_by_idx ON public.story_idea USING btree (created_by);


--
-- Name: story_idea_reader_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX story_idea_reader_user_idx ON public.story_idea_reader USING btree (user_id);


--
-- Name: story_idea_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX story_idea_status_created_at_idx ON public.story_idea USING btree (status, created_at DESC);


--
-- Name: strike_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX strike_user_id_idx ON public.strike USING btree (user_id, issued_at);


--
-- Name: sub_forum_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sub_forum_category_id_idx ON public.sub_forum USING btree (category_id, "position", id);


--
-- Name: user_avatar_file_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_avatar_file_idx ON public.user_avatar USING btree (file_id);


--
-- Name: user_banned_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_banned_by_idx ON public."user" USING btree (banned_by) WHERE (banned_by IS NOT NULL);


--
-- Name: user_block_blocked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_block_blocked_idx ON public.user_block USING btree (blocked_id);


--
-- Name: user_in_chat_group_chat_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_in_chat_group_chat_group_id_idx ON public.user_in_chat_group USING btree (chat_group_id);


--
-- Name: user_in_writing_group_invited_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_in_writing_group_invited_by_idx ON public.user_in_writing_group USING btree (invited_by) WHERE (invited_by IS NOT NULL);


--
-- Name: user_in_writing_group_writing_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_in_writing_group_writing_group_id_idx ON public.user_in_writing_group USING btree (writing_group_id);


--
-- Name: user_invited_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_invited_by_idx ON public."user" USING btree (invited_by) WHERE (invited_by IS NOT NULL);


--
-- Name: user_one_primordial_admin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_one_primordial_admin_idx ON public."user" USING btree ((true)) WHERE is_primordial_admin;


--
-- Name: user_platform_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_platform_role_idx ON public."user" USING btree (platform_role) WHERE (platform_role IS NOT NULL);


--
-- Name: user_session_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_session_expires_at_idx ON public.user_session USING btree (expires_at);


--
-- Name: user_session_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_session_user_id_idx ON public.user_session USING btree (user_id);


--
-- Name: user_token_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_token_expires_at_idx ON public.user_token USING btree (expires_at);


--
-- Name: user_token_one_outstanding_per_purpose; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_token_one_outstanding_per_purpose ON public.user_token USING btree (user_id, purpose) WHERE (consumed_at IS NULL);


--
-- Name: user_token_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_token_user_id_idx ON public.user_token USING btree (user_id);


--
-- Name: writing_folder_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_folder_created_by_idx ON public.writing_folder USING btree (created_by);


--
-- Name: writing_folder_parent_folder_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_folder_parent_folder_id_idx ON public.writing_folder USING btree (parent_folder_id) WHERE (parent_folder_id IS NOT NULL);


--
-- Name: writing_folder_writing_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_folder_writing_group_id_idx ON public.writing_folder USING btree (writing_group_id, created_at);


--
-- Name: writing_group_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_group_created_by_idx ON public.writing_group USING btree (created_by);


--
-- Name: writing_group_next_step_completed_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_group_next_step_completed_by_idx ON public.writing_group_next_step USING btree (completed_by) WHERE (completed_by IS NOT NULL);


--
-- Name: writing_group_next_step_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_group_next_step_created_by_idx ON public.writing_group_next_step USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: writing_group_next_step_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_group_next_step_group_idx ON public.writing_group_next_step USING btree (writing_group_id, completed_at, created_at);


--
-- Name: writing_group_pseudonymous_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_group_pseudonymous_idx ON public.writing_group USING btree (id) WHERE authors_are_pseudonymous;


--
-- Name: writing_page_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_page_created_by_idx ON public.writing_page USING btree (created_by);


--
-- Name: writing_page_folder_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_page_folder_id_idx ON public.writing_page USING btree (folder_id) WHERE (folder_id IS NOT NULL);


--
-- Name: writing_page_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_page_updated_by_idx ON public.writing_page USING btree (updated_by) WHERE (updated_by IS NOT NULL);


--
-- Name: writing_page_writing_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_page_writing_group_id_idx ON public.writing_page USING btree (writing_group_id, last_activity_at DESC);


--
-- Name: writing_post_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_post_created_by_idx ON public.writing_post USING btree (created_by);


--
-- Name: writing_post_edited_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_post_edited_by_idx ON public.writing_post USING btree (edited_by) WHERE (edited_by IS NOT NULL);


--
-- Name: writing_post_one_draft_per_author; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX writing_post_one_draft_per_author ON public.writing_post USING btree (writing_thread_id, created_by) WHERE is_draft;


--
-- Name: writing_post_writing_thread_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_post_writing_thread_id_idx ON public.writing_post USING btree (writing_thread_id);


--
-- Name: writing_thread_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_thread_created_by_idx ON public.writing_thread USING btree (created_by);


--
-- Name: writing_thread_folder_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_thread_folder_id_idx ON public.writing_thread USING btree (folder_id) WHERE (folder_id IS NOT NULL);


--
-- Name: writing_thread_writing_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX writing_thread_writing_group_id_idx ON public.writing_thread USING btree (writing_group_id);


--
-- Name: user_in_chat_group delete_chat_group_after_last_user_leaves; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER delete_chat_group_after_last_user_leaves AFTER DELETE ON public.user_in_chat_group FOR EACH ROW EXECUTE FUNCTION public.delete_chat_group_after_last_user_leaves();


--
-- Name: user_in_writing_group delete_writing_group_after_last_user_leaves; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER delete_writing_group_after_last_user_leaves AFTER DELETE ON public.user_in_writing_group FOR EACH ROW EXECUTE FUNCTION public.delete_writing_group_after_last_user_leaves();


--
-- Name: user_in_chat_group set_invited_joined_at_for_user_in_chat_group; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_invited_joined_at_for_user_in_chat_group BEFORE INSERT OR UPDATE ON public.user_in_chat_group FOR EACH ROW EXECUTE FUNCTION public.set_invited_joined_at_for_user_in_chat_group();


--
-- Name: user_in_writing_group set_invited_joined_at_for_user_in_writing_group; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_invited_joined_at_for_user_in_writing_group BEFORE INSERT OR UPDATE ON public.user_in_writing_group FOR EACH ROW EXECUTE FUNCTION public.set_invited_joined_at_for_user_in_writing_group();


--
-- Name: chat_group set_last_activity_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_last_activity_at BEFORE UPDATE ON public.chat_group FOR EACH ROW EXECUTE FUNCTION public.set_last_activity_at();


--
-- Name: writing_group set_last_activity_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_last_activity_at BEFORE UPDATE ON public.writing_group FOR EACH ROW EXECUTE FUNCTION public.set_last_activity_at();


--
-- Name: writing_page set_last_activity_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_last_activity_at BEFORE UPDATE OF title, document, text, updated_by ON public.writing_page FOR EACH ROW EXECUTE FUNCTION public.set_last_activity_at();


--
-- Name: writing_thread set_last_activity_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_last_activity_at BEFORE UPDATE OF title ON public.writing_thread FOR EACH ROW EXECUTE FUNCTION public.set_last_activity_at();


--
-- Name: chat_message set_last_activity_at_for_chat_group; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_last_activity_at_for_chat_group AFTER INSERT OR DELETE OR UPDATE ON public.chat_message FOR EACH ROW EXECUTE FUNCTION public.set_last_activity_at_for_chat_group();


--
-- Name: forum_post set_last_activity_at_for_forum_thread; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_last_activity_at_for_forum_thread AFTER INSERT OR DELETE OR UPDATE ON public.forum_post FOR EACH ROW EXECUTE FUNCTION public.set_last_activity_at_for_forum_thread();


--
-- Name: writing_thread set_last_activity_at_for_writing_group; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_last_activity_at_for_writing_group AFTER INSERT OR DELETE OR UPDATE OF title, last_activity_at ON public.writing_thread FOR EACH ROW EXECUTE FUNCTION public.set_last_activity_at_for_writing_group();


--
-- Name: writing_post set_last_activity_at_for_writing_thread; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_last_activity_at_for_writing_thread AFTER INSERT OR DELETE OR UPDATE ON public.writing_post FOR EACH ROW EXECUTE FUNCTION public.set_last_activity_at_for_writing_thread();


--
-- Name: user set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public."user" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_session set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_session FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: activity_window activity_window_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_window
    ADD CONSTRAINT activity_window_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: banned_ip banned_ip_banned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banned_ip
    ADD CONSTRAINT banned_ip_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_application blind_date_application_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_application
    ADD CONSTRAINT blind_date_application_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_application blind_date_application_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_application
    ADD CONSTRAINT blind_date_application_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.blind_date_offer(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_application blind_date_application_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_application
    ADD CONSTRAINT blind_date_application_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: blind_date_exclusion blind_date_exclusion_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_exclusion
    ADD CONSTRAINT blind_date_exclusion_added_by_fkey FOREIGN KEY (added_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_exclusion blind_date_exclusion_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_exclusion
    ADD CONSTRAINT blind_date_exclusion_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: blind_date_feedback blind_date_feedback_pair_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_feedback
    ADD CONSTRAINT blind_date_feedback_pair_id_fkey FOREIGN KEY (pair_id) REFERENCES public.blind_date_pair(id) ON DELETE CASCADE;


--
-- Name: blind_date_feedback blind_date_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_feedback
    ADD CONSTRAINT blind_date_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: blind_date_name_suspicion blind_date_name_suspicion_pair_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_name_suspicion
    ADD CONSTRAINT blind_date_name_suspicion_pair_id_fkey FOREIGN KEY (pair_id) REFERENCES public.blind_date_pair(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: blind_date_name_suspicion blind_date_name_suspicion_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_name_suspicion
    ADD CONSTRAINT blind_date_name_suspicion_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.report(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: blind_date_name_suspicion blind_date_name_suspicion_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_name_suspicion
    ADD CONSTRAINT blind_date_name_suspicion_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_name_suspicion blind_date_name_suspicion_suspected_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_name_suspicion
    ADD CONSTRAINT blind_date_name_suspicion_suspected_id_fkey FOREIGN KEY (suspected_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: blind_date_name_suspicion blind_date_name_suspicion_writing_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_name_suspicion
    ADD CONSTRAINT blind_date_name_suspicion_writing_post_id_fkey FOREIGN KEY (writing_post_id) REFERENCES public.writing_post(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_offer blind_date_offer_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_offer
    ADD CONSTRAINT blind_date_offer_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_pair blind_date_pair_ended_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_pair
    ADD CONSTRAINT blind_date_pair_ended_by_fkey FOREIGN KEY (ended_by) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: blind_date_pair blind_date_pair_exchange_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_pair
    ADD CONSTRAINT blind_date_pair_exchange_thread_id_fkey FOREIGN KEY (exchange_thread_id) REFERENCES public.writing_thread(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_pair blind_date_pair_matched_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_pair
    ADD CONSTRAINT blind_date_pair_matched_by_fkey FOREIGN KEY (matched_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_pair blind_date_pair_rpg_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_pair
    ADD CONSTRAINT blind_date_pair_rpg_thread_id_fkey FOREIGN KEY (rpg_thread_id) REFERENCES public.writing_thread(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_pair blind_date_pair_writing_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_pair
    ADD CONSTRAINT blind_date_pair_writing_group_id_fkey FOREIGN KEY (writing_group_id) REFERENCES public.writing_group(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: blind_date_partner blind_date_partner_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_partner
    ADD CONSTRAINT blind_date_partner_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.blind_date_application(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blind_date_partner blind_date_partner_pair_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_partner
    ADD CONSTRAINT blind_date_partner_pair_id_fkey FOREIGN KEY (pair_id) REFERENCES public.blind_date_pair(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: blind_date_partner blind_date_partner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blind_date_partner
    ADD CONSTRAINT blind_date_partner_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: blocked_email_domain blocked_email_domain_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocked_email_domain
    ADD CONSTRAINT blocked_email_domain_added_by_fkey FOREIGN KEY (added_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: blocked_word blocked_word_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocked_word
    ADD CONSTRAINT blocked_word_added_by_fkey FOREIGN KEY (added_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: chat_group chat_group_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_group
    ADD CONSTRAINT chat_group_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: chat_message chat_message_chat_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message
    ADD CONSTRAINT chat_message_chat_group_id_fkey FOREIGN KEY (chat_group_id) REFERENCES public.chat_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_message chat_message_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message
    ADD CONSTRAINT chat_message_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: custom_page custom_page_last_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_page
    ADD CONSTRAINT custom_page_last_edited_by_fkey FOREIGN KEY (last_edited_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: favourite favourite_chat_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourite
    ADD CONSTRAINT favourite_chat_group_id_fkey FOREIGN KEY (chat_group_id) REFERENCES public.chat_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: favourite favourite_forum_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourite
    ADD CONSTRAINT favourite_forum_post_id_fkey FOREIGN KEY (forum_post_id) REFERENCES public.forum_post(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: favourite favourite_story_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourite
    ADD CONSTRAINT favourite_story_idea_id_fkey FOREIGN KEY (story_idea_id) REFERENCES public.story_idea(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: favourite favourite_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourite
    ADD CONSTRAINT favourite_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: favourite favourite_writing_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourite
    ADD CONSTRAINT favourite_writing_group_id_fkey FOREIGN KEY (writing_group_id) REFERENCES public.writing_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: favourite favourite_writing_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourite
    ADD CONSTRAINT favourite_writing_page_id_fkey FOREIGN KEY (writing_page_id) REFERENCES public.writing_page(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: favourite favourite_writing_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourite
    ADD CONSTRAINT favourite_writing_post_id_fkey FOREIGN KEY (writing_post_id) REFERENCES public.writing_post(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: favourite favourite_writing_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favourite
    ADD CONSTRAINT favourite_writing_thread_id_fkey FOREIGN KEY (writing_thread_id) REFERENCES public.writing_thread(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: forum_post forum_post_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_post
    ADD CONSTRAINT forum_post_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: forum_post forum_post_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_post
    ADD CONSTRAINT forum_post_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: forum_post forum_post_forum_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_post
    ADD CONSTRAINT forum_post_forum_thread_id_fkey FOREIGN KEY (forum_thread_id) REFERENCES public.forum_thread(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: forum_thread forum_thread_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_thread
    ADD CONSTRAINT forum_thread_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: forum_thread forum_thread_sub_forum_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_thread
    ADD CONSTRAINT forum_thread_sub_forum_id_fkey FOREIGN KEY (sub_forum_id) REFERENCES public.sub_forum(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: notification notification_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notification notification_recipient_id_chat_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_recipient_id_chat_group_id_fkey FOREIGN KEY (recipient_id, chat_group_id) REFERENCES public.user_in_chat_group(user_id, chat_group_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notification notification_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notification notification_recipient_id_writing_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_recipient_id_writing_group_id_fkey FOREIGN KEY (recipient_id, writing_group_id) REFERENCES public.user_in_writing_group(user_id, writing_group_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notification notification_writing_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_writing_page_id_fkey FOREIGN KEY (writing_page_id) REFERENCES public.writing_page(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notification notification_writing_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_writing_post_id_fkey FOREIGN KEY (writing_post_id) REFERENCES public.writing_post(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notification notification_writing_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_writing_thread_id_fkey FOREIGN KEY (writing_thread_id) REFERENCES public.writing_thread(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: profile_answer profile_answer_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_answer
    ADD CONSTRAINT profile_answer_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.profile_question_option(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: profile_answer profile_answer_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_answer
    ADD CONSTRAINT profile_answer_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.profile_question(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: profile_answer profile_answer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_answer
    ADD CONSTRAINT profile_answer_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: profile_question_option profile_question_option_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_question_option
    ADD CONSTRAINT profile_question_option_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.profile_question(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: report report_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reported_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reported_author_id_fkey FOREIGN KEY (reported_author_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reported_chat_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reported_chat_group_id_fkey FOREIGN KEY (reported_chat_group_id) REFERENCES public.chat_group(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reported_chat_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reported_chat_message_id_fkey FOREIGN KEY (reported_chat_message_id) REFERENCES public.chat_message(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reported_forum_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reported_forum_post_id_fkey FOREIGN KEY (reported_forum_post_id) REFERENCES public.forum_post(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reported_story_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reported_story_idea_id_fkey FOREIGN KEY (reported_story_idea_id) REFERENCES public.story_idea(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reported_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reported_writing_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reported_writing_group_id_fkey FOREIGN KEY (reported_writing_group_id) REFERENCES public.writing_group(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reported_writing_page_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reported_writing_page_id_fkey FOREIGN KEY (reported_writing_page_id) REFERENCES public.writing_page(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reported_writing_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reported_writing_post_id_fkey FOREIGN KEY (reported_writing_post_id) REFERENCES public.writing_post(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reported_writing_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reported_writing_thread_id_fkey FOREIGN KEY (reported_writing_thread_id) REFERENCES public.writing_thread(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: report report_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report
    ADD CONSTRAINT report_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: status_update_comment status_update_comment_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_update_comment
    ADD CONSTRAINT status_update_comment_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: status_update_comment status_update_comment_status_update_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_update_comment
    ADD CONSTRAINT status_update_comment_status_update_id_fkey FOREIGN KEY (status_update_id) REFERENCES public.status_update(id) ON DELETE CASCADE;


--
-- Name: status_update status_update_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_update
    ADD CONSTRAINT status_update_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: story_idea story_idea_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_idea
    ADD CONSTRAINT story_idea_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: story_idea_reader story_idea_reader_story_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_idea_reader
    ADD CONSTRAINT story_idea_reader_story_idea_id_fkey FOREIGN KEY (story_idea_id) REFERENCES public.story_idea(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: story_idea_reader story_idea_reader_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_idea_reader
    ADD CONSTRAINT story_idea_reader_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: strike strike_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strike
    ADD CONSTRAINT strike_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: strike strike_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strike
    ADD CONSTRAINT strike_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sub_forum sub_forum_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_forum
    ADD CONSTRAINT sub_forum_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.forum_category(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: user_avatar user_avatar_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_avatar
    ADD CONSTRAINT user_avatar_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user user_banned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: user_block user_block_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_block
    ADD CONSTRAINT user_block_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_block user_block_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_block
    ADD CONSTRAINT user_block_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_in_chat_group user_in_chat_group_chat_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_in_chat_group
    ADD CONSTRAINT user_in_chat_group_chat_group_id_fkey FOREIGN KEY (chat_group_id) REFERENCES public.chat_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_in_chat_group user_in_chat_group_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_in_chat_group
    ADD CONSTRAINT user_in_chat_group_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_in_writing_group user_in_writing_group_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_in_writing_group
    ADD CONSTRAINT user_in_writing_group_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: user_in_writing_group user_in_writing_group_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_in_writing_group
    ADD CONSTRAINT user_in_writing_group_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_in_writing_group user_in_writing_group_writing_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_in_writing_group
    ADD CONSTRAINT user_in_writing_group_writing_group_id_fkey FOREIGN KEY (writing_group_id) REFERENCES public.writing_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user user_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: user_session user_session_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT user_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_token user_token_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_token
    ADD CONSTRAINT user_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: watchlist_entry watchlist_entry_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_entry
    ADD CONSTRAINT watchlist_entry_added_by_fkey FOREIGN KEY (added_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: watchlist_entry watchlist_entry_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_entry
    ADD CONSTRAINT watchlist_entry_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: writing_folder writing_folder_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_folder
    ADD CONSTRAINT writing_folder_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: writing_folder writing_folder_parent_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_folder
    ADD CONSTRAINT writing_folder_parent_folder_id_fkey FOREIGN KEY (parent_folder_id) REFERENCES public.writing_folder(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: writing_folder writing_folder_writing_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_folder
    ADD CONSTRAINT writing_folder_writing_group_id_fkey FOREIGN KEY (writing_group_id) REFERENCES public.writing_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: writing_group writing_group_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_group
    ADD CONSTRAINT writing_group_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: writing_group_next_step writing_group_next_step_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_group_next_step
    ADD CONSTRAINT writing_group_next_step_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: writing_group_next_step writing_group_next_step_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_group_next_step
    ADD CONSTRAINT writing_group_next_step_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: writing_group_next_step writing_group_next_step_writing_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_group_next_step
    ADD CONSTRAINT writing_group_next_step_writing_group_id_fkey FOREIGN KEY (writing_group_id) REFERENCES public.writing_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: writing_page writing_page_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_page
    ADD CONSTRAINT writing_page_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: writing_page writing_page_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_page
    ADD CONSTRAINT writing_page_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.writing_folder(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: writing_page writing_page_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_page
    ADD CONSTRAINT writing_page_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: writing_page writing_page_writing_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_page
    ADD CONSTRAINT writing_page_writing_group_id_fkey FOREIGN KEY (writing_group_id) REFERENCES public.writing_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: writing_post writing_post_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_post
    ADD CONSTRAINT writing_post_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: writing_post writing_post_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_post
    ADD CONSTRAINT writing_post_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: writing_post writing_post_writing_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_post
    ADD CONSTRAINT writing_post_writing_thread_id_fkey FOREIGN KEY (writing_thread_id) REFERENCES public.writing_thread(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: writing_thread writing_thread_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_thread
    ADD CONSTRAINT writing_thread_created_by_fkey FOREIGN KEY (created_by) REFERENCES public."user"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: writing_thread writing_thread_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_thread
    ADD CONSTRAINT writing_thread_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.writing_folder(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: writing_thread writing_thread_writing_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.writing_thread
    ADD CONSTRAINT writing_thread_writing_group_id_fkey FOREIGN KEY (writing_group_id) REFERENCES public.writing_group(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

-- migrate:down

-- The whole schema, because that is what this migration creates. `public` is recreated empty so
-- the database stays usable — dbmate's own bookkeeping lives in `migration` and is untouched.
DROP SCHEMA public CASCADE;

CREATE SCHEMA public;

-- Recreated, so the comment initdb wrote is gone and `pg_dump` starts spelling the schema out —
-- which makes a rolled-back-and-reapplied database differ from a freshly built one in the dump,
-- and that difference is exactly what one compares when checking a migration. Restored so a round
-- trip leaves nothing behind.
COMMENT ON SCHEMA public IS 'standard public schema';
