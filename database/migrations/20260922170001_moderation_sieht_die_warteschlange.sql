-- migrate:up

-- Die Moderation sieht die ganze Warteschlange, wie bisher — jetzt, weil ihre Rolle die
-- Berechtigung hat, und nicht mehr, weil sie vorbereiten darf. Der Ur-Admin kann sie ihr nehmen.
INSERT INTO public.platform_role_permission (role, permission)
VALUES ('moderator', 'see_whole_queue');

-- migrate:down

DELETE FROM public.platform_role_permission
WHERE role = 'moderator' AND permission = 'see_whole_queue';
